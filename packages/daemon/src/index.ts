#!/usr/bin/env node
/**
 * bastra-recall daemon — MCP server over a markdown memory vault.
 *
 * Tools exposed:
 *   recall(query, k?, scope?, type?)  → top-k matches
 *   load_memory(id)                   → full memory content (frontmatter + body)
 *
 * Configuration (env):
 *   BASTRA_VAULT_PATH — required. Absolute path to the vault directory
 *                       (e.g. /Users/n0mad/Daniel/memorys).
 *                       Legacy alias `NEXUS_VAULT_PATH` wird noch gelesen.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  Vault,
  SearchIndex,
  EmbeddingIndex,
  OpenAIEmbeddingProvider,
  OllamaEmbeddingProvider,
  RelatedEnricher,
  pickPhrase,
  banterModeFromEnv,
  progressIndexFor,
  RECALL_STAGE_ORDER,
  type EmbeddingProvider,
  type RecallStage,
  type StageListener,
} from "@bastra-recall/core";
import * as path from "node:path";
import { Telemetry, logDirFor } from "./telemetry.js";
import { startHttpServer } from "./http.js";
import { embeddingStatusLine, type EmbeddingStatus, type EmbeddingSource } from "./embedding-status.js";
import { getEmbeddingProvider, getCommonsEnabled } from "./settings.js";
import { commonsPath, loadVerificationCounts } from "./cli/commons.js";
import { existsSync } from "node:fs";
import {
  recallHandler,
  loadMemoryHandler,
  saveMemoryHandler,
  MEMORY_TOOL_DEFS,
  type ToolDeps,
} from "./tool-handlers.js";
import {
  documentTools,
  FindDocumentArgs,
  ReadDocumentArgs,
  OpenDocumentArgs,
  findDocument,
  readDocument,
  openDocument,
} from "./documents-handler.js";
import {
  documentWriteTools,
  SaveDocumentArgs,
  RecategorizeDocumentArgs,
  MoveDocumentArgs,
  saveDocument,
  recategorizeDocument,
  moveDocument,
} from "./documents-write-handler.js";
import { productDocTools, saveProductDocHandler } from "./product-doc-handler.js";
import { envFirst, envInt, envFloat, envBool } from "./env.js";
import { startBackgroundCheck } from "./update-check.js";
import { writeSharedVaultSize } from "./statusline-session.js";
import { reapStaleForwarderProcesses } from "./reap-forwarders.js";
import { prewarmOllamaModel, unloadOllamaModel } from "./ollama-lifecycle.js";
import { ensureOllamaServerForDaemon } from "./cli/ollama.js";
import { spawnSync } from "node:child_process";

// Triage Issue #24: Write-Tools sind Pro-Feature. Aktuelles Gate ist ein
// env-Flag — wenn ein Pro-License-Service kommt, ersetzt der das hier.
const DOCUMENT_WRITE_ENABLED = envFirst("BASTRA_DOCUMENT_WRITE", "NEXUS_DOCUMENT_WRITE") === "1";

const DAEMON_VERSION = "0.6.6-beta.1";
const DEFAULT_HTTP_PORT = 6723;

const VAULT_PATH = envFirst("BASTRA_VAULT_PATH", "NEXUS_VAULT_PATH");
if (!VAULT_PATH) {
  console.error(
    "[bastra-recall] FATAL: BASTRA_VAULT_PATH is not set. " +
      "Point it at the directory holding your memory .md files.",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const vault = new Vault(VAULT_PATH!);
  const { loaded, skipped } = await vault.init();
  console.error(
    `[bastra-recall] vault loaded: ${loaded} memorys` +
      (skipped.length ? `, ${skipped.length} skipped` : ""),
  );
  for (const s of skipped) {
    console.error(`[bastra-recall]   skipped ${s.path}: ${s.err}`);
  }
  vault.startWatching();

  // Publish the live vault size to a shared file so every session's statusline
  // — including idle ones that make no tool calls — shows the current memory
  // count. The per-session forwarder feed only refreshes on that session's own
  // calls, so without this an idle session shows a stale count after another
  // session (or an external write the watcher caught) changes the vault.
  // Debounced so a burst of watcher events collapses into one write.
  const publishVaultSize = (() => {
    let last = -1;
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const size = vault.size();
        if (size !== last) {
          last = size;
          writeSharedVaultSize(size);
        }
      }, 300);
      timer.unref?.();
    };
  })();
  writeSharedVaultSize(vault.size()); // initial, before any event
  vault.on(() => publishVaultSize());

  // Periodic disk reconcile: the fs watcher misses external writes/deletes on
  // cloud-storage mounts (GoogleDrive/iCloud), so size() — and the shared
  // count — would otherwise drift whenever the Mac app or another process
  // touches the vault directly. reconcile() walks the disk itself (watcher-
  // independent) and emits add/remove events, which flow through the listener
  // above into the shared file. Set BASTRA_VAULT_RECONCILE_MS=0 to disable.
  const reconcileMs = envInt("BASTRA_VAULT_RECONCILE_MS", 60_000);
  if (reconcileMs > 0) {
    const reconcileTimer = setInterval(() => {
      void vault.reconcile().catch(() => {});
    }, reconcileMs);
    reconcileTimer.unref();
  }

  const search = new SearchIndex(vault);
  search.start();

  // Bastra Commons: read-only Community-Rezept-Index. Bewusst BM25-only —
  // kein Embedding-Backfill, kein RelatedEnricher: in das git-synchronisierte
  // Verzeichnis wird NIE geschrieben (#104-Lektion: ein Schreiber weniger).
  let commonsSearch: SearchIndex | null = null;
  let commonsVerifications: Map<string, { works: number; fails: number }> | null = null;
  if (await getCommonsEnabled()) {
    const recipesDir = path.join(commonsPath(), "recipes");
    if (existsSync(recipesDir)) {
      try {
        const commonsVault = new Vault(recipesDir);
        await commonsVault.init();
        commonsSearch = new SearchIndex(commonsVault);
        commonsSearch.start();
        // verify-Loop: Records einlesen — Evidenz fließt ins Fusion-Ranking.
        commonsVerifications = loadVerificationCounts(commonsPath());
        const verified = [...commonsVerifications.values()].reduce((s, v) => s + v.works + v.fails, 0);
        console.error(`[bastra-recall] commons: enabled (${commonsVault.size()} recipes, ${verified} verification records from ${recipesDir})`);
      } catch (err) {
        console.error(`[bastra-recall] commons: failed to load (${(err as Error).message}) — continuing without`);
        commonsSearch = null;
      }
    } else {
      console.error(`[bastra-recall] commons: enabled but not cloned — run 'bastra commons enable'`);
    }
  }

  // Hybrid-Recall: provider precedence env → cli-settings.json → API-key → none.
  // embeddingStatusLine logs the resolved mode on EVERY path including success —
  // the silent-success path was the root of #79.
  // Vor dem Embedding-Block konstruiert, weil Prewarm/Unload (#109) ihre
  // Lifecycle-Events darüber loggen.
  const telemetry = new Telemetry();

  const { provider, status: embeddingStatus, ollama } = await resolveEmbedding();
  console.error(embeddingStatusLine(embeddingStatus));
  // Für /health (#92): Runtime-Health des Index, nicht nur die Boot-Config.
  let embIdxForHealth: EmbeddingIndex | null = null;
  if (provider) {
    const persistPath = path.join(VAULT_PATH!, ".bastra", "embeddings.json");
    const embIdx = new EmbeddingIndex(vault, provider, persistPath);
    embIdxForHealth = embIdx;
    // Wakeup (#78): Ollama-Server sicherstellen (Autostart, falls z.B. die
    // Mac-App beendet wurde, die ihn hielt), dann das Modell parallel zum
    // restlichen Boot laden — der erste Recall nach einem Cold-Start trifft
    // ein warmes Modell. Fire-and-forget, blockiert weder Vault-Load noch
    // /health.
    if (ollama) {
      void (async () => {
        const auto = await ensureOllamaServerForDaemon(ollama.baseURL);
        if (auto.detail !== "already running") {
          console.error(`[bastra-recall] ollama autostart: ${auto.detail}`);
        }
        const ok = await prewarmOllamaModel(ollama.baseURL, ollama.model, ollama.keepAlive);
        void telemetry.logOllamaLifecycle({
          action: "prewarm",
          model: ollama.model,
          ok,
          last_embed_age_ms: null,
          embed_calls_since_boot: embIdx.providerCallCount(),
        });
      })();
    }
    // Auto-Related-Enricher: pflegt frontmatter.related_via nach jedem Embed-
    // Batch. Threshold/topN über Env überschreibbar, sonst RelatedEnricher-
    // Defaults (top 5, cosine ≥ 0.7).
    const enricher = new RelatedEnricher(vault, embIdx, {
      topN: envInt("BASTRA_RELATED_TOP_N", 5),
      threshold: envFloat("BASTRA_RELATED_THRESHOLD", 0.7),
    });
    embIdx
      .start()
      .then(() => {
        search.useEmbeddings(embIdx);
        if (envBool("BASTRA_AUTO_RELATED", true)) {
          enricher.start();
          console.error(
            `[bastra-recall] auto-related: enabled (top ${envInt("BASTRA_RELATED_TOP_N", 5)} ≥ ${envFloat("BASTRA_RELATED_THRESHOLD", 0.7)})`,
          );
        }
        console.error(
          `[bastra-recall] embeddings ready provider=${provider.id} (${embIdx.size()} vectors, ${embIdx.pendingSize()} pending)`,
        );
      })
      .catch((err) => {
        console.error(`[bastra-recall] embeddings start error: ${err}`);
      });
  }

  // Update-check (fire-and-forget, opt-out via BASTRA_UPDATE_CHECK=off).
  // Caches result on disk for 24h → no GitHub-API hit on every daemon restart.
  // #81: in mode=auto staged der Daemon das Update selbst (Desktop hat keine
  // Hook-Fläche); das Flag triggert unten den Idle-Restart im LaunchAgent-Mode.
  let stagedRestartPending = false;
  startBackgroundCheck(DAEMON_VERSION, {
    onAutoStaged: () => {
      stagedRestartPending = true;
    },
  });

  // Stale-Forwarder-Sweep (#80): Desktop-Zombies (toter Client, lebender
  // disclaimer-Wrapper) beim Boot wegräumen. Verzögert + unref'd, damit der
  // health-kritische Boot-Pfad (#78) keinen ps-Roundtrip zahlt.
  setTimeout(() => reapStaleForwarderProcesses(), 5_000).unref();

  if (telemetry.isEnabled()) {
    console.error(`[bastra-recall] telemetry: enabled (log path: ${logDirFor()})`);
  } else {
    console.error(`[bastra-recall] telemetry: disabled`);
  }

  // Shared dependency-bag — wird sowohl vom MCP-stdio-Handler als auch von den
  // HTTP-REST-Routes konsumiert. Damit teilen beide Pfade Tool-Logik und
  // Telemetry; kein Drift.
  const toolDeps: ToolDeps = {
    vault,
    search,
    telemetry,
    vaultPath: VAULT_PATH!,
    commonsSearch,
    commonsVerifications,
  };

  // Idle self-shutdown: the shared daemon is spawned on demand by the
  // mcp-forwarder, so it can safely self-terminate after a stretch of no
  // activity — the next recall respawns it. Keeps the process table clean
  // (no orphaned daemons after sessions end). 0 disables. Default 30 min.
  const idleShutdownMs = envInt("BASTRA_DAEMON_IDLE_SHUTDOWN_MS", 30 * 60 * 1000);
  let lastActivityMs = Date.now();
  const markActivity = (): void => {
    lastActivityMs = Date.now();
  };

  const httpPort = envInt("BASTRA_HTTP_PORT", DEFAULT_HTTP_PORT, "NEXUS_HTTP_PORT");
  const httpHandle =
    envFirst("BASTRA_HTTP", "NEXUS_HTTP") === "off"
      ? { port: null, close: async () => undefined }
      : await startHttpServer({
          port: Number.isFinite(httpPort) ? httpPort : DEFAULT_HTTP_PORT,
          vault,
          search,
          telemetry,
          version: DAEMON_VERSION,
          toolDeps,
          documentWriteEnabled: DOCUMENT_WRITE_ENABLED,
          onActivity: markActivity,
          embedding: embeddingStatus,
          embeddingHealth: () => embIdxForHealth?.runtimeHealth() ?? null,
        });

  const server = new Server(
    { name: "bastra-recall", version: "0.6.6-beta.1" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      ...MEMORY_TOOL_DEFS,
      ...documentTools,
      ...(DOCUMENT_WRITE_ENABLED ? documentWriteTools : []),
      ...productDocTools,
    ],
  }));


  // Banter-Lang: nutzt BASTRA_BANTER_LANG (de|en), default `en` —
  // MCP-Clients sind heterogen, ein deutsches "Stichwörter durchforsten"
  // im englischen Chat-Verlauf wirkt fremd. Deutsche Mac-App-User setzen
  // BASTRA_BANTER_LANG=de in ihrer Shell oder dem Daemon-Launchd-Plist.
  const banterMode = banterModeFromEnv(process.env);
  const banterLang = (process.env.BASTRA_BANTER_LANG ?? "en").toLowerCase() === "de" ? "de" : "en";

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    markActivity();
    const { name, arguments: args } = req.params;

    if (name === "recall") {
      try {
        // MCP-Progress-Notification (#38): wenn der Caller einen
        // progressToken mitschickt, leiten wir Stage-Events als
        // `notifications/progress` weiter. Claude Code rendert die als
        // Live-Stage-Lines unter dem Tool-Aufruf. Banter-Phrase landet
        // im `message`-Feld der Notification.
        const progressToken = (req.params as { _meta?: { progressToken?: string | number } })._meta
          ?.progressToken;
        const onStage: StageListener | undefined = progressToken !== undefined
          ? (s: RecallStage) => {
              // Nur Stop-Events (mit durationMs) als Progress-Tick
              // emittieren — Start-Events würden Claude Code mit
              // doppelten Lines fluten.
              if (s.durationMs === undefined && s.name !== "cache.hit" && s.name !== "done") return;
              const phrase = pickPhrase(s, banterMode, banterLang);
              const message = phrase
                ? `${s.name} — ${phrase}${s.durationMs !== undefined ? ` (${s.durationMs}ms)` : ""}`
                : `${s.name}${s.durationMs !== undefined ? ` (${s.durationMs}ms)` : ""}`;
              // Fire-and-forget — Notification-Failures dürfen den
              // Recall nicht kippen.
              void extra.sendNotification({
                method: "notifications/progress",
                params: {
                  progressToken,
                  progress: progressIndexFor(s.name),
                  total: RECALL_STAGE_ORDER.length,
                  message,
                },
              }).catch(() => undefined);
            }
          : undefined;
        const result = await recallHandler(toolDeps, args, { onStage });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }

    if (name === "load_memory") {
      try {
        const result = await loadMemoryHandler(toolDeps, args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }

    if (name === "save_memory") {
      try {
        const result = await saveMemoryHandler(toolDeps, args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }

    if (name === "save_product_doc") {
      try {
        const result = await saveProductDocHandler(toolDeps, args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }

    if (name === "find_document") {
      const parsed = FindDocumentArgs.safeParse(args);
      if (!parsed.success) return errorResult(parsed.error.message);
      const result = findDocument(search, parsed.data);
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    }

    if (name === "read_document") {
      const parsed = ReadDocumentArgs.safeParse(args);
      if (!parsed.success) return errorResult(parsed.error.message);
      const doc = readDocument(vault, parsed.data);
      if (!doc) return errorResult(`document not found: ${parsed.data.id}`);
      return {
        content: [
          { type: "text", text: JSON.stringify(doc, null, 2) },
        ],
      };
    }

    if (name === "open_document") {
      const parsed = OpenDocumentArgs.safeParse(args);
      if (!parsed.success) return errorResult(parsed.error.message);
      const result = openDocument(vault, parsed.data);
      if ("ok" in result && !result.ok) {
        return errorResult(result.message);
      }
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
    }

    if (name === "save_document" || name === "recategorize_document" || name === "move_document") {
      if (!DOCUMENT_WRITE_ENABLED) {
        return errorResult(
          `${name} is a Pro feature — set BASTRA_DOCUMENT_WRITE=1 to enable.`,
        );
      }
      try {
        if (name === "save_document") {
          const parsed = SaveDocumentArgs.safeParse(args);
          if (!parsed.success) return errorResult(parsed.error.message);
          const result = await saveDocument(vault, parsed.data);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }
        if (name === "recategorize_document") {
          const parsed = RecategorizeDocumentArgs.safeParse(args);
          if (!parsed.success) return errorResult(parsed.error.message);
          const result = await recategorizeDocument(vault, parsed.data);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }
        // move_document
        const parsed = MoveDocumentArgs.safeParse(args);
        if (!parsed.success) return errorResult(parsed.error.message);
        const result = await moveDocument(vault, parsed.data);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }

    return errorResult(`unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[bastra-recall] MCP server ready on stdio`);

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.error("[bastra-recall] shutting down");
    search.stop();
    await vault.stop();
    await httpHandle.close();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  // Idle watchdog — terminate after `idleShutdownMs` without activity.
  // `.unref()` so the timer itself never keeps the process alive.
  //
  // #78 Hebel C: Besitzt ein LaunchAgent (KeepAlive=true) den Daemon, ist
  // Self-Terminate kontraproduktiv — launchd respawnt sofort, und jeder
  // Zyklus reißt ein Cold-Start-Fenster auf (Desktop: "no access to MCP",
  // weil der Forwarder-Health-Timeout während des Boots abläuft). Explizit
  // gesetztes BASTRA_DAEMON_IDLE_SHUTDOWN_MS bleibt ein User-Override.
  const idleEnvSet = (process.env.BASTRA_DAEMON_IDLE_SHUTDOWN_MS ?? "") !== "";
  const launchAgentOwned = launchAgentOwnsDaemon();
  if (idleShutdownMs > 0 && !idleEnvSet && launchAgentOwned) {
    console.error(
      "[bastra-recall] LaunchAgent registered — idle self-shutdown disabled (launchd owns the lifecycle, #78)",
    );
  } else if (idleShutdownMs > 0) {
    const tick = Math.min(idleShutdownMs, 60_000);
    const idleLabel =
      idleShutdownMs >= 60_000
        ? `${Math.round(idleShutdownMs / 60000)}min`
        : `${Math.round(idleShutdownMs / 1000)}s`;
    const idleTimer = setInterval(() => {
      if (Date.now() - lastActivityMs >= idleShutdownMs) {
        console.error(
          `[bastra-recall] idle for ${idleLabel} — self-terminating (respawns on next recall)`,
        );
        void shutdown();
      }
    }, tick);
    idleTimer.unref();
  }

  // #81: Ein warmer LaunchAgent-Daemon restartet nie von selbst — ein
  // auto-staged Update würde nie live gehen. Nach dem Stage: bei ≥15 min
  // Inaktivität sauber beenden; launchd (KeepAlive) respawnt sofort mit dem
  // neuen Code. Im Forwarder-Mode erledigt das der Idle-Self-Shutdown.
  if (launchAgentOwned) {
    const stagedRestartTimer = setInterval(() => {
      if (stagedRestartPending && Date.now() - lastActivityMs >= 15 * 60 * 1000) {
        stagedRestartPending = false;
        console.error(
          "[bastra-recall] staged update applied — idle restart to load the new code (#81); launchd respawns",
        );
        void shutdown();
      }
    }, 60_000);
    stagedRestartTimer.unref();
  }

  // Energie (#78): Embedding-Modell nach Embed-Idle aus dem Ollama-RAM
  // entladen — der "Idle-Befehl". Greift in BEIDEN Daemon-Modi (LaunchAgent
  // warm / forwarder-spawned): der Daemon bleibt reaktionsschnell, nur das
  // ~600-MB-Modell verlässt den RAM; der nächste Embed (oder der SessionStart-
  // Hook-Recall) lädt es in 1–2 s zurück. 0 disables. Default 10 min.
  const ollamaUnloadMs = envInt("BASTRA_OLLAMA_IDLE_UNLOAD_MS", 10 * 60 * 1000);
  if (ollama && ollamaUnloadMs > 0) {
    const bootAt = Date.now();
    let lastUnloadAt = 0;
    const unloadTimer = setInterval(() => {
      // Letzter erfolgreicher Provider-Call (search ODER Backfill-Batch);
      // vor dem ersten Embed zählt der Boot (deckt das Prewarm-Load ab).
      const lastUse = embIdxForHealth?.runtimeHealth().lastOkAt ?? bootAt;
      if (lastUse > lastUnloadAt && Date.now() - lastUse >= ollamaUnloadMs) {
        lastUnloadAt = Date.now();
        void unloadOllamaModel(ollama.baseURL, ollama.model).then((ok) =>
          telemetry.logOllamaLifecycle({
            action: "unload",
            model: ollama.model,
            ok,
            last_embed_age_ms: Date.now() - lastUse,
            embed_calls_since_boot: embIdxForHealth?.providerCallCount() ?? null,
          }),
        );
      }
    }, 60_000);
    unloadTimer.unref();
  }
}

const LAUNCH_AGENT_LABEL = "ai.n0mad.bastra-recall";

/** true wenn der bastra-LaunchAgent in der gui-Domain registriert ist (#78). */
function launchAgentOwnsDaemon(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    const uid = process.getuid?.() ?? 0;
    const r = spawnSync("/bin/launchctl", ["print", `gui/${uid}/${LAUNCH_AGENT_LABEL}`], {
      stdio: "ignore",
      timeout: 5_000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function errorResult(msg: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: msg }],
  };
}

interface OllamaInfo {
  baseURL: string;
  model: string;
  keepAlive: string | number;
}

/**
 * Resolve the embedding provider with explicit precedence:
 *   1. env BASTRA_EMBEDDING_PROVIDER  — wins over the file (none|ollama|openai)
 *   2. cli-settings.json embedding.provider — only when env is unset
 *   3. backwards-compat — OPENAI_API_KEY present, no explicit choice → openai
 *   4. none → BM25 only
 * Returns the provider instance (or null) plus a status used for /health + the
 * single user-facing log line.
 */
async function resolveEmbedding(): Promise<{
  provider: EmbeddingProvider | null;
  status: EmbeddingStatus;
  ollama?: OllamaInfo;
}> {
  const envProvider = (process.env.BASTRA_EMBEDDING_PROVIDER ?? "").toLowerCase();
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.BASTRA_EMBEDDING_KEY;

  // Tier 1: explicit env wins over the file.
  if (envProvider === "none") return offEmbedding("env");
  if (envProvider === "ollama") return ollamaEmbedding("env");
  if (envProvider === "openai") return apiKey ? openaiEmbedding("env", apiKey) : offEmbedding("env");
  if (envProvider) {
    // A typo'd env value must NOT silently disable embeddings and shadow a valid
    // file choice — warn and fall through (treat as "no opinion"), like the file path.
    console.error(
      `[bastra-recall] ignoring invalid BASTRA_EMBEDDING_PROVIDER ${JSON.stringify(process.env.BASTRA_EMBEDDING_PROVIDER)} — falling through to cli-settings / API-key`,
    );
  }

  // Tier 2: cli-settings.json (env unset or invalid → treat as no opinion).
  const fileProvider = await getEmbeddingProvider();
  if (fileProvider === "none") return offEmbedding("cli-settings");
  if (fileProvider === "ollama") return ollamaEmbedding("cli-settings");
  if (fileProvider === "openai") return apiKey ? openaiEmbedding("cli-settings", apiKey) : offEmbedding("cli-settings");

  // Tier 3: backwards-compat — key present, no explicit choice anywhere.
  if (apiKey) return openaiEmbedding("api-key", apiKey);

  // Tier 4: nothing requested.
  return offEmbedding("none");
}

function ollamaEmbedding(source: EmbeddingSource): {
  provider: EmbeddingProvider;
  status: EmbeddingStatus;
  ollama: OllamaInfo;
} {
  const baseURL = process.env.BASTRA_OLLAMA_URL ?? "http://localhost:11434";
  const model = process.env.BASTRA_EMBEDDING_MODEL ?? "embeddinggemma";
  const dimEnv = process.env.BASTRA_EMBEDDING_DIM;
  const parsed = dimEnv ? Number.parseInt(dimEnv, 10) : undefined;
  // Number.isFinite guard: `NaN ?? 768` keeps NaN (NaN isn't nullish), which
  // would poison the index dim. A non-numeric env value → fall back to default.
  const dim = parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
  // keep_alive pro Embed-Request (#78 Power-Plan): hält das Modell während
  // aktiver Arbeit warm, ohne es für immer im RAM zu pinnen.
  const keepAlive = process.env.BASTRA_OLLAMA_KEEP_ALIVE ?? "10m";
  const provider = new OllamaEmbeddingProvider({ baseURL, model, dim, keepAlive });
  return { provider, status: { on: true, providerId: provider.id, source }, ollama: { baseURL, model, keepAlive } };
}

function openaiEmbedding(source: EmbeddingSource, apiKey: string): { provider: EmbeddingProvider; status: EmbeddingStatus } {
  const provider = new OpenAIEmbeddingProvider({ apiKey });
  return { provider, status: { on: true, providerId: provider.id, source } };
}

function offEmbedding(source: EmbeddingSource): { provider: null; status: EmbeddingStatus } {
  return { provider: null, status: { on: false, providerId: null, source } };
}

main().catch((err) => {
  console.error("[bastra-recall] FATAL:", err);
  process.exit(1);
});
