/**
 * Local HTTP endpoint for Claude Code hooks (PreToolUse / SessionStart / …)
 * UND REST-API für externe Caller (ChatGPT Custom GPT Actions via Cloudflare
 * Tunnel, weitere MCP-Forwarder-Sessions, andere AI-Agents).
 *
 * Lives alongside the stdio MCP transport in the same daemon process so the
 * in-memory BM25 index, der Embedding-Index und der RelatedEnricher EIN MAL
 * gehalten werden — egal wie viele Sessions/Clients gerade angedockt sind.
 *
 * Bind policy: 127.0.0.1 only. Wenn ein anderer bastra-recall daemon den
 * Port hält, geben wir auf und überlassen ihm die Endpoints (Vault-Pfad ist
 * by convention identisch). Für public exposure: Cloudflare-Tunnel / ngrok
 * davor und BASTRA_API_TOKEN setzen.
 *
 * Endpoints:
 *   GET  /health                         → { ok, vault_size, version }
 *   GET  /api/v1/health                  → dasselbe für den Browser (Token+
 *                                          CORS; /health trägt keine CORS-
 *                                          Header, siehe http-health.ts)
 *   POST /hook/recall                    → hook-spezifisch (Telemetry-Pfad,
 *                                          loopback-only, kein Auth)
 *
 *   REST-API (alle POST, JSON-Body, JSON-Antwort, mit Auth+CORS):
 *   POST /api/v1/recall                  → wie MCP-Tool recall
 *   POST /api/v1/load_memory             → wie MCP-Tool load_memory
 *   POST /api/v1/save_memory             → wie MCP-Tool save_memory
 *   POST /api/v1/find_document           → wie MCP-Tool find_document
 *   POST /api/v1/read_document           → wie MCP-Tool read_document
 *   POST /api/v1/open_document           → wie MCP-Tool open_document
 *   POST /api/v1/save_document           → Pro-gated
 *   POST /api/v1/recategorize_document   → Pro-gated
 *   POST /api/v1/move_document           → Pro-gated
 *
 *   Floor-Registry (#141/#142, Auth wie die anderen /api/v1-Tools):
 *   POST /api/v1/floors                  → Floor hinzufügen/rewriten
 *   POST /api/v1/floors/release          → alle Einträge einer condition lösen
 *   POST /api/v1/floors/affirm           → last_affirmed stampen (braucht why)
 *   GET  /api/v1/floors[?scope=…]        → rohe Registry-Einträge
 *   GET  /hook/floors[?scope=…]          → Einträge + title/summary-Join
 *                                          (loopback-only, kein Auth)
 *
 * Auth (für /api/v1/* — /hook/recall und /health bleiben offen, sind
 * loopback-only):
 *   - Wenn BASTRA_API_TOKEN gesetzt: Authorization: Bearer <token>
 *     erforderlich.
 *   - Loopback-Aufrufe (127.0.0.1) werden per Default ohne Token
 *     akzeptiert (BASTRA_AUTH_LOOPBACK_SKIP=0 erzwingt Token auch lokal).
 *   - Ohne gesetzten Token läuft alles offen — dev/local mode.
 *
 * CORS (für /api/v1/*):
 *   - BASTRA_CORS_ORIGIN (default LEER = deny-all, #95) — Komma-Liste erlaubter
 *     Browser-Origins; nur gelistete werden zurückgespiegelt. "*" bleibt als
 *     explizites Tunnel/Dev-Opt-in. Für die Prod-Admin-App gehört ihre HTTPS-
 *     Origin (z.B. https://bastra.io) in die Liste.
 *   - Private Network Access: ein Preflight von öffentlicher HTTPS-Origin auf
 *     den localhost-Daemon wird automatisch mit
 *     `Access-Control-Allow-Private-Network: true` beantwortet (nur wenn die
 *     Origin erlaubt ist).
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildGraph, buildSemanticLayout, type SemanticLayout } from "@bastra-recall/core";
import type {
  Vault,
  SearchIndex,
  RecallHit,
  RecallStage,
  StageListener,
  EmbeddingRuntimeHealth,
} from "@bastra-recall/core";
import type { EmbeddingBreakerSnapshot } from "./embedding-breaker.js";
import { fireAndForget, type Telemetry } from "./telemetry.js";
import { envBool, envInt } from "./env.js";
import { computeSalienceShadow } from "./salience-shadow.js";
import { computeTrustShadow, trustRankMode, usageForShadow } from "./trust-shadow.js";
import { handleHookReflex } from "./reflex.js";
import { runPromptLane, type ClaudeHookPayload } from "./prompt-lane.js";
import { runWriteLane, type WriteHookPayload } from "./write-lane.js";
import { computeHeat, computeReach, readUsage } from "./usage-sidecar.js";
import { buildHealthPayload } from "./http-health.js";
import { createStalenessMonitor, defaultStalenessIo } from "./code-staleness.js";
import {
  recallHandler,
  loadMemoryHandler,
  saveMemoryHandler,
  archiveMemoryHandler,
  toLeanHit,
  type ToolDeps,
} from "./tool-handlers.js";
import { expandQuery, type BridgePool } from "./learned-recall/bridges.js";
import { type SupportedLanguage } from "./learned-recall/language.js";
import { isWeakResult, isNoHome } from "./weak-result.js";
import {
  FindDocumentArgs,
  ReadDocumentArgs,
  OpenDocumentArgs,
  findDocument,
  readDocument,
  openDocument,
} from "./documents-handler.js";
import {
  SaveDocumentArgs,
  RecategorizeDocumentArgs,
  MoveDocumentArgs,
  saveDocument,
  recategorizeDocument,
  moveDocument,
} from "./documents-write-handler.js";
import { getUpdateState } from "./update-check.js";
import {
  handleWebUi,
  handleUiAnnotate,
  handleUiAnnotations,
  handleUiSearch,
  handleUiVaultImageGet,
  handleUiVaultImagePost,
  handleHookCare,
} from "./webui.js";
import { handleUiChat, type ChatFn } from "./webui-chat.js";
import { handleHookImport, handleUiImport } from "./import-review.js";
import { handleUiImportVault, handleUiFsBrowse } from "./import-vault.js";
import { listSkills, handleUiSkills } from "./skills-registry.js";
import { handleUiAreas } from "./webui-areas.js";
import { createLiveUpdates } from "./live-updates.js";
import { handleHookOnboarding, handleUiOnboarding } from "./onboarding.js";
import { handleSessionContext } from "./session-context.js";
import { listConventions, detectTaxonomyDrift } from "./taxonomy.js";
import { addFloor, affirm, listFloors, release } from "./floors.js";
import { liveIntent, readActs } from "./floor-acts.js";
import { handleCuratorRun, handleCuratorState, type CuratorRunDeps } from "./curator-run.js";
import {
  getApiToken,
  getCorsOrigins,
  getDocsLanguage,
  getDocsMode,
  setDocsLanguage,
  setDocsMode,
  isDocsMode,
  isDocsLanguage,
  DOCS_MODES,
} from "./settings.js";
import { saveProductDocHandler } from "./product-doc-handler.js";
import { ALL_TOOL_DEFS } from "./tool-defs.js";
import type { EmbeddingStatus } from "./embedding-status.js";

export interface HttpOptions {
  port: number;
  vault: Vault;
  search: SearchIndex;
  telemetry: Telemetry;
  version: string;
  toolDeps: ToolDeps;
  documentWriteEnabled: boolean;
  /** Called on every real request (everything except the liveness probes
   *  GET /health and GET /api/v1/health). Lets the
   *  daemon track activity for idle self-shutdown. */
  onActivity?: () => void;
  /** Resolved embedding mode — surfaced on /health so `bastra status` can show
   *  it (the daemon's own stderr is discarded when the forwarder spawns it). */
  embedding: EmbeddingStatus;
  /** Runtime-Health des Embedding-Providers (#92). Getter, weil sich der
   *  Zustand nach Boot ändert (Modell gelöscht, Ollama down → degraded;
   *  nächster Erfolg → wieder ok). null = kein Index aktiv. */
  embeddingHealth?: () => EmbeddingRuntimeHealth | null;
  /** Circuit-Breaker-Zustand (#165) für /health. null = kein Breaker aktiv
   *  (embeddings off). */
  embeddingBreaker?: () => EmbeddingBreakerSnapshot | null;
  /** Live vector snapshot für die semantic map (#207). Getter, weil der
   *  Index erst nach dem Boot attacht. null = embeddings off / not ready. */
  embeddingVectors?: () => ReadonlyMap<string, Float32Array> | null;
  /** Lokaler Chat-Client für den Such-Copiloten (#207). null = kein lokales
   *  Generierungsmodell verfügbar → /ui/chat antwortet 503. */
  uiChat?: ChatFn | null;
  /** Curator-Deps (#155/#156) für die /curator/*-Loopback-Endpoints. */
  curator?: CuratorRunDeps;
}

const MAX_BODY_BYTES = 256 * 1024; // 256 KiB — content excerpts are capped client-side

export interface HttpHandle {
  port: number | null;
  close: () => Promise<void>;
}

// Loopback-Aufrufe sehen wir an `127.0.0.1`/`::1`/`::ffff:127.0.0.1`. Wenn
// BASTRA_AUTH_LOOPBACK_SKIP nicht explizit auf "0" steht, dürfen sie
// /api/v1/* ohne Token aufrufen — der MCP-Forwarder läuft loopback und soll
// nicht jedes Mal authentifizieren müssen.
function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1"
  );
}

/**
 * Constant-time string equality for the Bearer-token check. The early return
 * on length mismatch leaks only the length — not secret here, the token has
 * a fixed format (`Bearer ` + 43-char base64url). Exported for unit tests.
 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * DNS-Rebinding-Gate für die token-losen Loopback-Endpoints (/hook/recall,
 * /vault/count, /health): ein Browser, der eine Angreifer-Domain auf
 * 127.0.0.1 umbiegt, schickt deren Hostname im Host-Header — aus Browser-
 * Sicht ist der Request dann same-origin, CORS greift nicht. Nur loopback-
 * Hosts werden bedient; BASTRA_ALLOWED_HOSTS (Komma-Liste) ist der Escape-
 * Hatch für Tunnel-Setups, die mehr als /api/v1/* exposen wollen. Fehlender
 * Host-Header (HTTP/1.0-CLIs) passiert — Rebinding trägt immer einen.
 * Exported for unit tests.
 */
export function isLoopbackHost(
  hostHeader: string | undefined,
  extraHosts: readonly string[],
): boolean {
  if (!hostHeader) return true;
  const lower = hostHeader.toLowerCase();
  const host = lower.replace(/:\d+$/, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
    return true;
  }
  return extraHosts.includes(host) || extraHosts.includes(lower);
}

/**
 * CORS allowlist from BASTRA_CORS_ORIGIN (#95). Unset/empty = EMPTY allowlist —
 * no browser origin is allowed until the user opts in. "*" must be set
 * explicitly (tunnel/dev); it is no longer the default, because together with
 * a minted token it would let ANY website that obtains the token through.
 * Local tools (CLI, forwarder — no Origin header) are unaffected either way.
 * Exported for unit tests.
 */
export function corsAllowlistFromEnv(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The effective CORS allowlist from its two sources, env as the ops override —
 * mirroring how BASTRA_API_TOKEN backstops the minted token: a non-empty
 * BASTRA_CORS_ORIGIN wins outright; otherwise the origins that `bastra token
 * --origin` wrote into cli-settings.json apply. Exported for unit tests.
 */
export function resolveCorsAllowlist(fromEnv: readonly string[], fromSettings: readonly string[]): string[] {
  return fromEnv.length > 0 ? [...fromEnv] : [...fromSettings];
}

/**
 * Which Origin to reflect in `Access-Control-Allow-Origin`. `null` = the origin
 * isn't allowed → emit no ACAO header and the browser blocks the response. "*"
 * in the allowlist is permissive (tunnel/dev): reflect the caller's origin, or
 * "*" when there's none. Exported for unit tests.
 */
export function resolveCorsOrigin(
  reqOrigin: string | undefined,
  allow: readonly string[],
): string | null {
  if (allow.includes("*")) return reqOrigin ?? "*";
  if (reqOrigin && allow.includes(reqOrigin)) return reqOrigin;
  return null;
}

/**
 * Auth decision for /api/v1/*. A request WITH an Origin header is a browser
 * request (possibly a foreign site): it must be on the allowlist AND carry the
 * token — even over loopback, because the user's browser runs on 127.0.0.1 and
 * is indistinguishable from the CLI by TCP source; only the Origin header tells
 * them apart. Local tools (CLI, MCP-forwarder) send no Origin and may stay
 * tokenless via loopback-skip. Returns the HTTP status to apply. Exported for
 * unit tests.
 */
export function gateApiRequest(p: {
  reqOrigin: string | undefined;
  allowedOrigin: string | null;
  isLoopback: boolean;
  authHeader: string;
  apiToken: string;
  loopbackSkip: boolean;
}): 200 | 401 | 403 {
  const isBrowser = typeof p.reqOrigin === "string" && p.reqOrigin.length > 0;
  if (isBrowser) {
    if (!p.allowedOrigin) return 403;
    if (!p.apiToken || !safeEqual(p.authHeader, `Bearer ${p.apiToken}`)) return 401;
    return 200;
  }
  if (p.apiToken && !(p.loopbackSkip && p.isLoopback)) {
    if (!safeEqual(p.authHeader, `Bearer ${p.apiToken}`)) return 401;
  }
  return 200;
}

export async function startHttpServer(opts: HttpOptions): Promise<HttpHandle> {
  const { port, vault, telemetry, version, toolDeps, documentWriteEnabled, onActivity } = opts;
  const { search } = toolDeps;
  // #207: the semantic layout is the one genuinely heavy read (PCA + kNN over
  // every vector) — cache it per server, refreshed at most once a minute.
  let semanticCache: { at: number; body: SemanticLayout } | null = null;
  // #216: fresh-memory buffer for the map's live mode (supernova + card)
  const liveUpdates = createLiveUpdates(vault);
  // "read"-Notices (#216): jeder load_memory landet als Live-Ereignis in der Map
  telemetry.onMemoryLoaded = (id) => liveUpdates.notifyRead(id);
  // "surfaced"-Notices (#221): recall/hook_recall lassen ihre servierten
  // Treffer aufleuchten — nicht nur das seltene load_memory. Was serviert
  // gilt, entscheidet das Band (`surfacedHits` in telemetry.ts), nicht ein
  // hier gesetztes Top-N; der REANNOUNCE-Cooldown in live-updates deckelt
  // dann die Frequenz pro id.
  telemetry.onRecalled = (hits) => {
    for (const h of hits) liveUpdates.notifyRead(h.id, h.band);
  };

  // env wins (ops override); else the token minted by `bastra token` in
  // cli-settings.json. Empty = no token issued → browser clients are rejected.
  const apiToken = process.env.BASTRA_API_TOKEN || (await getApiToken()) || "";
  const loopbackSkip = (process.env.BASTRA_AUTH_LOOPBACK_SKIP ?? "1") !== "0";
  // CORS-Allowlist (Komma-Liste). Default seit #95: LEER — Browser-Origins
  // müssen explizit freigeschaltet werden (BASTRA_CORS_ORIGIN=https://your.host).
  // "*" bleibt als explizites Opt-in für Tunnel/Dev. Bei einer echten Liste
  // wird die Request-Origin nur zurückgespiegelt, wenn sie erlaubt ist — sonst
  // kein ACAO-Header und der Browser blockt die Response selbst. Browser-
  // Requests (Origin gesetzt) müssen zusätzlich das Token tragen (siehe Gate).
  // Quelle wie beim Token: env gewinnt als Ops-Override; sonst die von
  // `bastra token --origin` in cli-settings.json freigeschaltete Liste.
  const fromEnv = corsAllowlistFromEnv(process.env.BASTRA_CORS_ORIGIN);
  const corsAllow = resolveCorsAllowlist(fromEnv, await getCorsOrigins());
  if (corsAllow.includes("*") && apiToken) {
    console.error(
      "[bastra-recall] WARNING: BASTRA_CORS_ORIGIN=* with a minted API token — ANY website that obtains the token can call /api/v1/* from the browser. Set an explicit allowlist: BASTRA_CORS_ORIGIN=https://your.host",
    );
  }
  // Zusätzliche Hosts für das Rebinding-Gate (Tunnel-Setups, die auch die
  // loopback-only Endpoints exposen wollen). /api/v1/* braucht das nicht —
  // dort schützt das Token.
  const allowedHosts = (process.env.BASTRA_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // Stamped when the server is wired up, not at module load: the value that
  // matters is "how long has this daemon been answering", and the two differ
  // by whatever the vault took to index.
  const startedAtMs = Date.now();

  // #329 — the disk can be replaced under a running process, and until this
  // existed nothing noticed. Probed lazily from the health path (throttled)
  // rather than on a timer: no extra clock, and the answer is at most one
  // throttle window old on the door where it is actually read.
  const staleness = createStalenessMonitor(version, defaultStalenessIo());

  /** Reachability + vault size, shared by /health and /api/v1/health. */
  const healthPayload = (): Record<string, unknown> =>
    buildHealthPayload({
      vaultSize: () => vault.size(),
      version,
      embedding: opts.embedding,
      embeddingHealth: opts.embeddingHealth,
      embeddingBreaker: opts.embeddingBreaker,
      updateState: getUpdateState,
      startedAtMs,
      codeStale: () => staleness.check(),
    });

  /** Liveness probes, on both doors — they must not count as activity. */
  const isHealthProbe = (url: string): boolean => url === "/health" || url === "/api/v1/health";

  const server = createServer((req, res) => {
    const t0 = Date.now();
    const url = req.url ?? "";
    const method = req.method ?? "GET";

    // Activity signal for idle self-shutdown — count real work, not the cheap
    // liveness pings (else a monitor, or bastra.io's admin bridge probing every
    // 60s, would keep us alive forever).
    if (!isHealthProbe(url)) onActivity?.();

    // DNS-Rebinding-Gate für alles außer /api/v1/* (dort schützt das Token):
    // die offenen Endpoints sind loopback-only by design — ein nicht-loopback
    // Host-Header heißt, ein Browser wurde auf 127.0.0.1 umgebogen.
    if (!url.startsWith("/api/v1/") && !isLoopbackHost(req.headers.host, allowedHosts)) {
      sendJson(res, 403, { error: "host not allowed" });
      return;
    }

    // CORS preflight for /api/v1/*
    if (method === "OPTIONS" && url.startsWith("/api/v1/")) {
      const allowedOrigin = resolveCorsOrigin(req.headers.origin, corsAllow);
      // Private Network Access (Chrome): ein Preflight von öffentlicher HTTPS-
      // Origin auf die localhost-Ressource (Prod-Admin-App https://bastra.io →
      // 127.0.0.1-Daemon) trägt diesen Request-Header und wird sonst geblockt.
      // Nur beim Preflight beantworten, nur wenn die Origin erlaubt ist.
      const allowPrivateNetwork =
        allowedOrigin !== null &&
        req.headers["access-control-request-private-network"] === "true";
      sendCors(res, allowedOrigin, { allowPrivateNetwork });
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === "GET" && url === "/health") {
      sendJson(res, 200, healthPayload());
      return;
    }

    // The daemon's own tool definitions (#132): the stdio forwarder fetches
    // these so the schema a client is told always matches what THIS daemon
    // validates — no skew when a forwarder build is newer than the daemon code
    // in RAM. Loopback-only + token-free like /health (the Host-gate above
    // covers it; this is non-/api/v1).
    if (method === "GET" && url === "/tools") {
      sendJson(res, 200, { tools: ALL_TOOL_DEFS });
      return;
    }

    if (method === "GET" && url === "/vault/count") {
      // Reconcile the index against disk before answering — the fs watcher
      // misses external writes/deletes on cloud-storage mounts, so a plain
      // vault.size() can be stale. This is the fresh count the `bastra` status
      // panel reads. Falls back to the in-memory size if reconcile throws.
      vault
        .reconcile()
        .then((count) => sendJson(res, 200, { count }))
        .catch(() => sendJson(res, 200, { count: vault.size() }));
      return;
    }

    if (method === "POST" && url === "/hook/recall") {
      handleHookRecall(req, res, t0, vault, search, telemetry, toolDeps.learnedBridges, toolDeps.sharedRecallLang, toolDeps.embeddingDegraded);
      return;
    }

    // #217 Reflex-Lane: hartes recall_when-Matching ohne aktive Query, nur
    // über reflex-markierte Memories. Loopback-only wie /hook/recall.
    if (method === "POST" && url === "/hook/reflex") {
      handleHookReflex(req, res, t0, vault, telemetry);
      return;
    }

    // #343 (stage A of #305 direction 2): the full UserPromptSubmit pipeline,
    // server-side. The thin client POSTs {payload, client_ppid} and writes the
    // response body to stdout verbatim, so this endpoint returns the exact
    // document Claude Code expects — `{}` or the hookSpecificOutput envelope —
    // and fails open to `{}` with 200: the client must never see an error it
    // would only translate back into `{}` anyway. Loopback-only like
    // /hook/recall. Logic lives in prompt-lane.ts; this stays a route.
    if (method === "POST" && url === "/hook/prompt") {
      readJsonBody(req, MAX_BODY_BYTES)
        .then(async (body) => {
          const payload = (body.payload ?? {}) as ClaudeHookPayload;
          const ppid = typeof body.client_ppid === "number" ? body.client_ppid : null;
          const self = `http://127.0.0.1:${req.socket.localPort ?? 6723}`;
          const out = await runPromptLane(payload, ppid, self);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(out);
        })
        .catch(() => {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end("{}");
        });
      return;
    }

    // #343 second half: same contract as /hook/prompt, for the PreToolUse
    // Write/Edit lane. The skip gate stays in the thin client (pure stdlib,
    // fires on the majority of calls), so everything arriving here already
    // survived it. No client_ppid — this lane touches no statusline feed.
    if (method === "POST" && url === "/hook/write") {
      readJsonBody(req, MAX_BODY_BYTES)
        .then(async (body) => {
          const payload = (body.payload ?? {}) as WriteHookPayload;
          const self = `http://127.0.0.1:${req.socket.localPort ?? 6723}`;
          const out = await runWriteLane(payload, self);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(out);
        })
        .catch(() => {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end("{}");
        });
      return;
    }

    // #144: lightweight act-signal (PostToolUse:Bash). No recall, no injection —
    // only matches the excerpt against open loadedMemories episodes so
    // shell-driven applications of a memory can close them. Loopback-only
    // (Host-Gate above), no auth — same trust level as /hook/recall.
    if (method === "POST" && url === "/hook/act") {
      handleHookAct(req, res, telemetry);
      return;
    }

    // Surfaced-Feedback (#154): die Hook-CLI meldet die ids, die sie nach
    // ihrem client-seitigen Filtern WIRKLICH injiziert hat — nur die zählen
    // als "surfaced" im Usage-Sidecar. Loopback-only wie /hook/act.
    if (method === "POST" && url === "/hook/hinted") {
      readJsonBody(req, MAX_BODY_BYTES)
        .then((body) => {
          const ids = Array.isArray((body as { ids?: unknown })?.ids)
            ? ((body as { ids: unknown[] }).ids.filter((x) => typeof x === "string") as string[])
            : [];
          telemetry.recordSurfacedUsage(ids);
          sendJson(res, 200, { ok: true, counted: ids.length });
        })
        .catch(() => sendJson(res, 400, { error: "invalid body" }));
      return;
    }

    // Curator (#155/#156): Loopback-only wie /hook/* (Host-Gate oben).
    // GET = State lesen; POST = manueller Lauf, default dry-run (Review-
    // Anfrage, kein Demote-Consent) — Handler leben in curator-run.ts.
    if (opts.curator && method === "GET" && url === "/curator/state") {
      handleCuratorState(req, res, opts.curator);
      return;
    }
    if (opts.curator && method === "POST" && url === "/curator/run") {
      handleCuratorRun(req, res, opts.curator);
      return;
    }

    // Selbstlernende Taxonomie (#64): Konventions-Liste für die Session-Hook-
    // Injection (#66) und Drift-Analyse für den Stop-Hook (#67). Beides
    // loopback-only (Host-Gate oben), read-only, kein Auth — wie /hook/recall.
    if (method === "GET" && url === "/hook/taxonomy") {
      sendJson(res, 200, { conventions: listConventions(vault) });
      return;
    }
    if (method === "GET" && url === "/hook/drift") {
      sendJson(res, 200, { clusters: detectTaxonomyDrift(vault) });
      return;
    }

    // Vault-care count für die Session-Hook-Injection (#207): loopback-only,
    // read-only, kein Auth — wie /hook/taxonomy.
    if (method === "GET" && url === "/hook/care") {
      handleHookCare(res, toolDeps.vaultPath).catch(() => sendJson(res, 200, { open: 0 }));
      return;
    }

    // Floor-Registry (#141/#142): Einträge für die Session-Hook-Injection.
    // Loopback-only (Host-Gate oben), read-only, kein Auth — wie /hook/taxonomy.
    // Der Join id→title/summary passiert HIER via vault.get, damit die Hook-CLI
    // dumm bleibt (ein GET, keine per-Eintrag-Roundtrips). Ein nicht auflösbarer
    // Eintrag kommt ohne title zurück — sichtbar statt still (stale floor).
    if (method === "GET" && (url === "/hook/floors" || url.startsWith("/hook/floors?"))) {
      const u = new URL(url, "http://127.0.0.1");
      const scope = u.searchParams.get("scope") ?? undefined;
      listFloors(scope)
        .then((entries) => {
          const floors = entries.map((e) => {
            const mem = vault.get(e.memory_id);
            return {
              ...e,
              ...(mem ? { title: mem.fm.title, summary: mem.fm.summary } : {}),
            };
          });
          sendJson(res, 200, { floors });
        })
        .catch(() => sendJson(res, 200, { floors: [] }));
      return;
    }

    // Produkt-Doku-Settings für die Mac-App-Options-Pane: GET liest, POST
    // schreibt nach ~/.bastra/cli-settings.json (das OSS-owned Settings-File —
    // die App fasst es so nie direkt an). Loopback-only wie /hook/* (Host-Gate
    // oben); kein Token, weil dieselbe Maschine + derselbe User.
    if (url === "/settings/docs") {
      if (method === "GET") {
        Promise.all([getDocsMode(), getDocsLanguage()])
          .then(([mode, language]) => sendJson(res, 200, { mode, language }))
          .catch((err: Error) => sendJson(res, 500, { error: err.message }));
        return;
      }
      if (method === "POST") {
        readJsonBody(req, MAX_BODY_BYTES)
          .then(async (body) => {
            const mode = body.mode;
            const language = body.language;
            if (mode !== undefined && !isDocsMode(mode)) {
              sendJson(res, 400, { error: `mode must be one of: ${DOCS_MODES.join(" | ")}` });
              return;
            }
            if (language !== undefined && !isDocsLanguage(language)) {
              sendJson(res, 400, { error: "language must be a short tag like 'en', 'de', 'pt-br'" });
              return;
            }
            if (isDocsMode(mode)) await setDocsMode(mode);
            if (isDocsLanguage(language)) await setDocsLanguage(language);
            sendJson(res, 200, { mode: await getDocsMode(), language: await getDocsLanguage() });
          })
          .catch((err: Error) => sendJson(res, 400, { error: err.message }));
        return;
      }
      sendJson(res, 405, { error: "method not allowed" });
      return;
    }

    // Vault care (#207): flags from the map, appended to vault-care.md in the
    // vault (open format — an AI session works the list off). Loopback-only
    // like /ui, gated on ui.enabled inside the handlers.
    if (method === "GET" && url === "/ui/annotations") {
      handleUiAnnotations(res, toolDeps.vaultPath).catch(() => sendJson(res, 500, { error: "ui error" }));
      return;
    }
    // Import review (#208): open candidate count for the session hook —
    // loopback-only like /hook/care.
    if (method === "GET" && url === "/hook/import") {
      handleHookImport(res, toolDeps.vaultPath).catch(() => sendJson(res, 500, { error: "import error" }));
      return;
    }
    // Visual import (#208): the map's import dialog stages candidates the
    // same way `bastra import` does. Staging only, never saves memories.
    if (method === "POST" && url === "/ui/import") {
      handleUiImport(req, res, toolDeps.vaultPath).catch(() => sendJson(res, 500, { error: "import error" }));
      return;
    }
    // Folder import (#215): the map's sibling of `bastra import vault <dir>` —
    // ingest a whole memory folder into the isolated imported/ subtree, then
    // reconcile so the new nodes show on the map at once. Writes directly (no
    // staging), but only into memories/imported/.
    if (method === "POST" && url === "/ui/import-vault") {
      handleUiImportVault(req, res, toolDeps.vaultPath, () => vault.reconcile()).catch(() =>
        sendJson(res, 500, { error: "import error" }),
      );
      return;
    }
    // Skills registry (#215): list + declare ("mark as skill" on a ghost) —
    // classifies the node into the skills ring on the next graph render.
    if ((method === "GET" || method === "POST") && url === "/ui/skills") {
      handleUiSkills(req, res).catch(() => sendJson(res, 500, { error: "skills error" }));
      return;
    }
    // Folder picker for the import dialog (#215): directory names only.
    if (method === "GET" && url.startsWith("/ui/fs")) {
      handleUiFsBrowse(req, res).catch(() => sendJson(res, 500, { error: "fs error" }));
      return;
    }
    // Live updates (#216): freshly saved memories for the map's live mode.
    if (method === "GET" && url.startsWith("/ui/updates")) {
      liveUpdates.handleUiUpdates(req, res).catch(() => sendJson(res, 500, { error: "updates error" }));
      return;
    }
    // Areas manager (#216): list / create / rename / delete the vault's
    // top-level areas. Bulk folder moves heal with one reconcile.
    if ((method === "GET" || method === "POST") && url === "/ui/areas") {
      handleUiAreas(req, res, toolDeps.vaultPath, () => vault.reconcile()).catch(() =>
        sendJson(res, 500, { error: "areas error" }),
      );
      return;
    }
    if (method === "POST" && url === "/ui/annotate") {
      handleUiAnnotate(req, res, toolDeps.vaultPath).catch(() => sendJson(res, 500, { error: "ui error" }));
      return;
    }
    // Onboarding interview: needed-flag for the session hook (loopback, not
    // ui-gated) and the map dialog's catalog + answer submission (ui-gated).
    if (method === "GET" && url === "/hook/onboarding") {
      handleHookOnboarding(res, toolDeps.vaultPath, vault.size()).catch(() => sendJson(res, 500, { error: "onboarding error" }));
      return;
    }
    if ((method === "GET" || method === "POST") && url === "/ui/onboarding") {
      handleUiOnboarding(req, res, toolDeps.vaultPath, vault.size()).catch(() => sendJson(res, 500, { error: "onboarding error" }));
      return;
    }
    // Session-context for hookless clients (Claude Desktop, Cursor): the MCP
    // forwarder appends this to the FIRST tool result of a client session —
    // the same context the SessionStart hook injects in Claude Code.
    // Loopback-only (Host-Gate above), read-only, no auth — like /hook/care.
    if (method === "GET" && url === "/hook/session-context") {
      handleSessionContext(req, res, toolDeps, vault).catch(() =>
        sendJson(res, 500, { error: "session-context error" }),
      );
      return;
    }
    // Semantic search for the map's search box (#207) — hybrid recall, lean.
    if (method === "GET" && url.startsWith("/ui/search")) {
      handleUiSearch(res, url, search).catch(() => sendJson(res, 500, { error: "ui error" }));
      return;
    }
    // Search copilot (#207): chat that deepens a search — local Ollama
    // generation model only, loopback-only like the rest of /ui.
    if (method === "POST" && url === "/ui/chat") {
      const getBody = (id: string) => {
        const m = vault.get(id);
        return m && m.fm.sensitivity !== "private" ? m.body : null;
      };
      handleUiChat(req, res, { search, chat: opts.uiChat ?? null, getBody }).catch(() =>
        sendJson(res, 500, { error: "ui error" }),
      );
      return;
    }
    // Ring-view center emblem (#207): stored as vault-image.<ext> at the
    // vault root — an open file like everything else the daemon writes.
    // Path-only match: the viewer cache-busts with ?ts=.
    if (url.split("?")[0] === "/ui/vault-image") {
      if (method === "GET") {
        handleUiVaultImageGet(res, url, toolDeps.vaultPath).catch(() => sendJson(res, 404, { error: "no vault image" }));
        return;
      }
      if (method === "POST") {
        handleUiVaultImagePost(req, res, url, toolDeps.vaultPath).catch(() => sendJson(res, 500, { error: "ui error" }));
        return;
      }
    }

    // Vault map web UI (#207): static viewer, opt-in via ui.enabled. Sits
    // outside /api/v1/* → loopback-only through the host gate above.
    if (method === "GET" && (url === "/ui" || url.startsWith("/ui/"))) {
      handleWebUi(req, res, url).catch(() => sendJson(res, 500, { error: "ui error" }));
      return;
    }

    // ─── REST-API /api/v1/* ──────────────────────────────────────
    if (url.startsWith("/api/v1/")) {
      const reqOrigin = req.headers.origin;
      const allowedOrigin = resolveCorsOrigin(reqOrigin, corsAllow);
      sendCors(res, allowedOrigin); // before the gate, so a 401/403 still carries CORS

      const gate = gateApiRequest({
        reqOrigin,
        allowedOrigin,
        isLoopback: isLoopback(req),
        authHeader: req.headers.authorization ?? "",
        apiToken,
        loopbackSkip,
      });
      if (gate === 403) {
        sendJson(res, 403, { error: "origin not allowed" });
        return;
      }
      if (gate === 401) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      // #141/#142: GET /api/v1/floors — der eine Read-Endpoint der REST-
      // Surface (rohe Registry-Einträge, token-auth wie die anderen /api/v1-
      // Tools; die loopback-Join-Variante fürs Hook-CLI ist /hook/floors).
      if (method === "GET") {
        const u = new URL(url, "http://127.0.0.1");
        // Reachability for a BROWSER. Same answer as /health, which a browser
        // cannot read (no CORS on token-free routes). Exists so a bridge never
        // has to spend a real recall — embedding, vector search and a "read"
        // notice — on the question "are you there".
        if (u.pathname === "/api/v1/health") {
          sendJson(res, 200, healthPayload());
          return;
        }
        if (u.pathname === "/api/v1/floors") {
          const scope = u.searchParams.get("scope") ?? undefined;
          // #198: the act log is the truth, the registry row is its cache.
          // Every entry carries `live_intent` so a governance surface never has
          // to decide which of two answers to believe. The raw `last_affirmed`
          // /`affirmed_by`/`why` stay on the wire as that cache.
          Promise.all([listFloors(scope), readActs()])
            .then(([entries, acts]) =>
              sendJson(res, 200, {
                floors: entries.map((e) => ({
                  ...e,
                  live_intent: liveIntent(e.memory_id, e.floored_at, acts, e),
                })),
              }),
            )
            .catch((err: Error) => sendJson(res, 500, { error: err.message }));
          return;
        }
        // #207: the open graph projection — nodes/edges/clusters/ghosts.
        // The viewer contract: the web UI, the Mac app, and external tools
        // all render from this same JSON (#140: no privileged viewer).
        if (u.pathname === "/api/v1/graph") {
          // Declared skills (#215) classify ghost targets into the skills
          // ring — one small JSON read, same viewer contract for everyone.
          // #217: plus Usage-Heat-Join aus dem #154-Sidecar (Daemon-Substrat;
          // buildGraph bleibt reine Vault-Projektion).
          (async () => {
            const skills = await listSkills();
            const graph = buildGraph(vault, skills);
            const usage = await readUsage(toolDeps.vaultPath);
            const heat = computeHeat(usage);
            // #227: die rohen Zähler neben die normalisierte Zahl. heat ist ein
            // Rang INNERHALB dieses Vaults — auf einem kalten Vault trägt der
            // eine berührte Knoten 1.0. Wer das unterscheiden will, braucht die
            // Zahlen dahinter, nicht nur den Anteil.
            const reach = computeReach(usage);
            // heat IMMER stampfen (0 statt Key-weglassen). zzallirog
            // (2026-07-18): `if (h) n.heat = h` machte kalten Node und Build-
            // ohne-Heat byte-identisch — ein frisch importierter Vault las sich
            // als „Feature fehlt". Eine API, die bei Null verstummt, lehrt
            // Consumer den falschen Schluss. Jetzt trägt jeder Node `heat`.
            for (const n of graph.nodes) {
              n.heat = heat[n.id] ?? 0;
              // Immer stampfen, auch bei Null — dieselbe Begründung wie oben
              // bei heat: eine API, die bei Null verstummt, lehrt Consumer den
              // falschen Schluss ("Feature fehlt" statt "noch nichts passiert").
              n.reach = reach[n.id] ?? { loaded: 0, acted_on: 0, weight: 0, last_at: null };
            }
            sendJson(res, 200, graph);
          })().catch((err: Error) => sendJson(res, 500, { error: err.message }));
          return;
        }
        // #207: the semantic layer — PCA positions by meaning + the
        // connections you never wrote (close in embedding space, no explicit
        // edge). 503 until the embedding index has vectors.
        if (u.pathname === "/api/v1/graph/semantic") {
          const vecs = opts.embeddingVectors?.() ?? null;
          if (!vecs || vecs.size === 0) {
            sendJson(res, 503, { error: "embeddings not ready" });
            return;
          }
          (async () => {
            if (!semanticCache || Date.now() - semanticCache.at > 60_000) {
              const skills = await listSkills();
              semanticCache = { at: Date.now(), body: buildSemanticLayout(buildGraph(vault, skills), vecs) };
            }
            sendJson(res, 200, semanticCache.body);
          })().catch((err: Error) => sendJson(res, 500, { error: err.message }));
          return;
        }
        // #207: full body of one node for the map inspector. Same sensitivity
        // default as the other externally reachable read paths (no private).
        if (u.pathname === "/api/v1/graph/node") {
          const id = u.searchParams.get("id") ?? "";
          const mem = vault.get(id);
          if (!mem || mem.fm.sensitivity === "private") {
            sendJson(res, 404, { error: `unknown node: ${id}` });
            return;
          }
          const { fm } = mem;
          sendJson(res, 200, {
            id: fm.id,
            title: fm.title,
            type: fm.type,
            scope: fm.scope,
            topic_path: fm.topic_path,
            tags: fm.tags,
            summary: fm.summary,
            related: fm.related,
            source: fm.source ?? null,
            created: fm.created,
            updated: fm.updated,
            body: mem.body,
          });
          return;
        }
      }

      if (method !== "POST") {
        sendJson(res, 405, { error: "method not allowed" });
        return;
      }

      const tool = url.slice("/api/v1/".length);

      // #74: Session/Turn-Header des Forwarders — machen MCP-Loads dem
      // echten CC-Turn zuordenbar (statt latestTurn-Raterei bei parallelen
      // Sessions). Fehlen die Header (alte Forwarder, Direkt-Caller), bleibt
      // alles beim inferred-Verhalten.
      const ccSessionHeader = req.headers["x-bastra-cc-session"];
      const ccTurnHeader = req.headers["x-bastra-cc-turn"];
      const ccSessionId = typeof ccSessionHeader === "string" && ccSessionHeader ? ccSessionHeader : null;
      const ccTurnKey = typeof ccTurnHeader === "string" ? Number(ccTurnHeader) : null;

      readJsonBody(req, MAX_BODY_BYTES)
        .then(async (body) => {
          try {
            toolDeps.telemetry.ensureTurn(ccSessionId, ccTurnKey);
            const result = await dispatchApi(tool, body, {
              toolDeps,
              documentWriteEnabled,
              ccSessionId,
            });
            if (result === undefined) {
              sendJson(res, 404, { error: `unknown tool: ${tool}` });
              return;
            }
            sendJson(res, 200, result);
          } catch (err) {
            sendJson(res, 400, { error: (err as Error).message });
          }
        })
        .catch((err: Error) => {
          sendJson(res, 400, { error: err.message });
        });
      return;
    }

    sendJson(res, 404, { error: `not found: ${method} ${url}` });
  });

  return new Promise<HttpHandle>((resolve) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code === "EADDRINUSE") {
        console.error(
          `[bastra-recall] http: port ${port} already in use — assuming another bastra-recall daemon owns it. Hooks will reach that one.`,
        );
        server.removeAllListeners("error");
        server.removeAllListeners("listening");
        resolve({
          port: null,
          close: async () => undefined,
        });
        return;
      }
      console.error(`[bastra-recall] http: failed to bind: ${err.message}`);
      resolve({
        port: null,
        close: async () => undefined,
      });
    };

    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      const addr = server.address() as AddressInfo;
      console.error(`[bastra-recall] http: listening on http://127.0.0.1:${addr.port}`);
      resolve({
        port: addr.port,
        close: () => closeServer(server),
      });
    });
  });
}

// ─── /hook/act handler (#144) ────────────────────────────────────

function handleHookAct(req: IncomingMessage, res: ServerResponse, telemetry: Telemetry): void {
  readJsonBody(req, MAX_BODY_BYTES)
    .then(async (body) => {
      const excerpt = typeof body.tool_input_excerpt === "string"
        ? body.tool_input_excerpt.slice(0, 4096)
        : "";
      if (!excerpt) {
        sendJson(res, 400, { error: "tool_input_excerpt is required" });
        return;
      }
      const toolName = typeof body.tool_name === "string" ? body.tool_name : null;
      const sessionId = typeof body.session_id === "string" ? body.session_id : null;
      const exitCode = typeof body.exit_code === "number" ? body.exit_code : null;

      const episodes = telemetry.matchLoadedMemories({
        tool_name: toolName,
        tool_input_excerpt: excerpt,
        session_id: sessionId,
        // High-frequency signal: only MATCHING episodes close; an unrelated
        // command must not kill an open episode with acted_on=false.
        closeOnMiss: false,
      });
      for (const episode of episodes) {
        fireAndForget(telemetry.logRecallEpisode(episode));
      }
      fireAndForget(
        telemetry.logHookAct({
          tool_name: toolName,
          excerpt_chars: excerpt.length,
          matched_episodes: episodes.length,
          exit_code: exitCode,
          // Claude-Session-id ins Event — ohne sie stempelt der Sink seine
          // Boot-UUID und der Transcript-Join ist unmöglich (Audit 2026-07-10).
          ...(sessionId ? { session_id: sessionId } : {}),
        }),
      );
      sendJson(res, 200, { matched: episodes.length });
    })
    .catch(() => sendJson(res, 400, { error: "invalid JSON body" }));
}

// ─── /hook/recall handler ────────────────────────────────────────

const CONTENT_RECALL_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * #342: deadline for the dense arm on the HOOK path only — the surface with a
 * hard client-side budget (HOOK_TIMEOUT_MS, 600ms). Offline callers (bridge
 * harvest, doc2query self-test, the WebUI) keep waiting indefinitely; they have
 * no budget and want the better result.
 *
 * The number comes from the per-stage split measured on a real host, and it is
 * a bound on THIS STAGE, not on the call:
 *
 *   warm   bm25 15-24ms   vector  87-96ms   →  total 106-113ms
 *   cold   bm25 24ms      vector 668ms      →  total 694ms
 *
 * So 150ms clears every warm dense arm with ~55ms to spare, and caps the cold
 * one at 150 + ~25ms of BM25 ≈ 180ms. That keeps BOTH cases under the 200ms
 * ceiling #305 set — the warm path untouched at ~110ms, the cold path degraded
 * to BM25-only but arriving, instead of the whole call expiring silently and
 * the turn continuing as if there had been nothing to say.
 *
 * 0 disables the deadline (kill switch, pre-#342 behaviour). Every expiry is
 * visible as `degraded: "vector-arm-timeout"` on the recall telemetry, so a
 * machine where the warm arm genuinely needs longer shows up as a rate rather
 * than as quietly worse recall.
 *
 * Read per call, not once at module load, like BASTRA_HOOK_CONTENT_RECALL
 * below: a latency kill switch that needs a daemon restart to take effect is
 * not much of a kill switch.
 */
const hookVectorDeadlineMs = (): number => envInt("BASTRA_VECTOR_DEADLINE_MS", 150);

export function mergeHookRecallHits(
  first: RecallHit[],
  second: RecallHit[],
  limit: number,
): RecallHit[] {
  const byId = new Map<string, RecallHit>();
  for (const hit of [...first, ...second]) {
    const previous = byId.get(hit.id);
    if (!previous) {
      byId.set(hit.id, hit);
      continue;
    }
    const winner = hit.score > previous.score ? hit : previous;
    byId.set(hit.id, {
      ...winner,
      matched_terms: [...new Set([...previous.matched_terms, ...hit.matched_terms])],
      matched_recall_when: previous.matched_recall_when || hit.matched_recall_when,
    });
  }
  return [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function handleHookRecall(
  req: IncomingMessage,
  res: ServerResponse,
  t0: number,
  vault: Vault,
  search: SearchIndex,
  telemetry: Telemetry,
  learnedBridges?: BridgePool | null,
  sharedRecallLang?: SupportedLanguage | null,
  embeddingDegraded?: () => boolean,
): void {
  // SSE-Branch (#38): wenn der Caller `Accept: text/event-stream`
  // sendet, streamen wir Stages live. Default-JSON-Response bleibt
  // BC-erhalten — alte Hook-CLIs und REST-Caller sehen keinen
  // Unterschied.
  const accept = String(req.headers.accept ?? "");
  const wantsSse = accept.includes("text/event-stream");

  readJsonBody(req, MAX_BODY_BYTES)
    .then(async (body) => {
      const query = typeof body.query === "string" ? body.query.trim() : "";
      if (!query) {
        if (wantsSse) {
          openSseHeaders(res);
          writeSseEvent(res, "error", { error: "query is required" });
          res.end();
        } else {
          sendJson(res, 400, { error: "query is required" });
        }
        return;
      }
      const k = clampInt(body.k, 1, 10, 3);
      const hookSessionId = typeof body.session_id === "string" ? body.session_id : null;
      const hookToolName = typeof body.tool_name === "string" ? body.tool_name : null;
      if (hookToolName === "UserPromptSubmit") {
        telemetry.rotateTurn(hookSessionId);
      }
      const scope = typeof body.scope === "string" ? body.scope : undefined;
      const type = typeof body.type === "string" ? body.type : undefined;
      // expand_hops: Hooks profitieren vom Multi-Hop-Recall sobald
      // related_via befüllt ist (über RelatedEnricher). Default 1 — der
      // Caller kann explizit 0 schicken um es zu deaktivieren.
      const expand_hops = body.expand_hops === 0 ? 0 : 1;

      const stageTimings: NonNullable<Parameters<Telemetry["logHookRecall"]>[0]["recall_stages"]> = {};
      // #342: why the hit list came back one-armed, if it did. Recorded rather
      // than merely returned — #305's whole finding is that this lane fails
      // quietly, and a degradation nobody counts repeats that failure one level
      // up: recall gets worse and the only visible symptom is that it got
      // faster. `vector-arm-timeout` is the deadline firing, `vector-arm-empty`
      // the pre-existing case where the arm had nothing to say.
      let degradedReason: string | undefined;
      const collectStage = (s: RecallStage): void => {
        if (s.name === "done" && typeof s.meta?.degraded === "string") {
          degradedReason = s.meta.degraded;
        }
        if (s.name === "cache.hit") {
          stageTimings.cache_hit = true;
          return;
        }
        if (s.durationMs === undefined) return;
        switch (s.name) {
          case "query.parse": stageTimings.query_parse_ms = s.durationMs; break;
          case "bm25.search": stageTimings.bm25_search_ms = s.durationMs; break;
          case "vector.search": stageTimings.vector_search_ms = s.durationMs; break;
          case "rrf.fuse": stageTimings.rrf_fuse_ms = s.durationMs; break;
          case "hops.expand": stageTimings.hops_expand_ms = s.durationMs; break;
          case "staleness.rank": stageTimings.staleness_rank_ms = s.durationMs; break;
        }
      };

      if (wantsSse) {
        openSseHeaders(res);
      }

      const onStage: StageListener = (s: RecallStage) => {
        collectStage(s);
        if (wantsSse) {
          // Nur Stop- + cache.hit + done-Events streamen (Start-Events
          // wären für UI redundant). `done`-Event kommt unten als
          // separater finaler SSE-Event mit den hits[] — wir
          // unterdrücken den Stage-`done`, damit der finale Frame
          // nicht doppelt rendert.
          if (s.name === "done") return;
          if (s.durationMs === undefined && s.name !== "cache.hit") return;
          writeSseEvent(res, "stage", {
            name: s.name,
            durationMs: s.durationMs,
            meta: s.meta,
          });
        }
      };

      // Shared learned-recall (#120): widen the hook query with language-matched
      // bridge terms. No-op when the layer is off. This is the highest-volume
      // recall surface, so the bridge boost must reach it too — not just MCP recall.
      const expansion = expandQuery(query, learnedBridges, {
        configuredLang: sharedRecallLang ?? null,
      });
      // #121: capture the deeper candidate pool (incl. below-floor) for the far slice.
      let candidatePool: { id: string; score: number }[] = [];
      const onQueryCandidatePool = (pool: { id: string; score: number }[]): void => {
        candidatePool = pool.map((h) => ({ id: h.id, score: h.score }));
      };
      const tRecall0 = Date.now();
      // #165: VOR dem Recall festgehalten, damit der Flag den Recall
      // beschreibt, der tatsächlich serviert wird (siehe recallHandler).
      const embeddingDegradedAtRecall =
        search.hasEmbeddings() && (embeddingDegraded?.() ?? false);
      let hits = search.hasEmbeddings()
        ? await search.recallHybrid(expansion.query, {
            k,
            scope,
            type,
            expand_hops,
            onStage,
            onCandidatePool: onQueryCandidatePool,
            vector_deadline_ms: hookVectorDeadlineMs(),
          })
        : search.recall(expansion.query, {
            k,
            scope,
            type,
            expand_hops,
            onStage,
            onCandidatePool: onQueryCandidatePool,
          });

      const contentQuery = typeof body.tool_input_excerpt === "string"
        ? body.tool_input_excerpt.trim().slice(0, 4096)
        : "";
      let contentRecall:
        | {
            hit_count: number;
            added_count: number;
            rescored_count: number;
            latency_ms: number;
            failed?: boolean;
          }
        | undefined;
      if (
        envBool("BASTRA_HOOK_CONTENT_RECALL", false)
        && CONTENT_RECALL_TOOLS.has(hookToolName ?? "")
        && contentQuery
        && contentQuery !== query
      ) {
        const contentRecallStarted = Date.now();
        try {
          const contentHits = search.hasEmbeddings()
            ? await search.recallHybrid(contentQuery, {
                k,
                scope,
                type,
                expand_hops,
                // Same deadline, not a remaining-budget split: by the time this
                // runs the query recall above has either warmed the model (so
                // this costs ~120ms) or is still loading it (so this expires
                // too and degrades the same way). Both are the right outcome.
                vector_deadline_ms: hookVectorDeadlineMs(),
              })
            : search.recall(contentQuery, {
                k,
                scope,
                type,
                expand_hops,
              });
          const queryHitsById = new Map(hits.map((hit) => [hit.id, hit]));
          const contentHitsById = new Map(contentHits.map((hit) => [hit.id, hit]));
          const mergedHits = mergeHookRecallHits(hits, contentHits, k);
          contentRecall = {
            hit_count: contentHits.length,
            added_count: mergedHits.filter((hit) => !queryHitsById.has(hit.id)).length,
            rescored_count: mergedHits.filter((hit) => {
              const queryHit = queryHitsById.get(hit.id);
              const contentHit = contentHitsById.get(hit.id);
              return queryHit !== undefined
                && contentHit !== undefined
                && contentHit.score > queryHit.score;
            }).length,
            latency_ms: Date.now() - contentRecallStarted,
          };
          hits = mergedHits;
        } catch {
          contentRecall = {
            hit_count: 0,
            added_count: 0,
            rescored_count: 0,
            latency_ms: Date.now() - contentRecallStarted,
            failed: true,
          };
        }
      }
      const recallLatencyMs = Date.now() - tRecall0;
      const totalLatencyMs = Date.now() - t0;
      const recallId = telemetry.newRecallId();
      telemetry.recordHookHints(recallId, hits);

      const toolInputExcerpt = typeof body.tool_input_excerpt === "string"
        ? body.tool_input_excerpt.slice(0, 4096)
        : "";
      if (toolInputExcerpt) {
        for (const episode of telemetry.matchLoadedMemories({
          tool_name: hookToolName,
          tool_input_excerpt: toolInputExcerpt,
          session_id: hookSessionId,
        })) {
          fireAndForget(telemetry.logRecallEpisode(episode));
        }
      }

      // #249/#230: both honesty flags, computed ONCE for this recall and used by
      // the telemetry row and the payload alike. They were computed twice from
      // the same inputs before, which is how `no_home` came to be recorded on the
      // MCP path and nowhere here.
      // #342: a recall that fell back to one arm did not run RRF, whatever the
      // reason — breaker open (#165), deadline expired, or the arm returning
      // nothing. All three serve raw BM25, which is unbounded, so the 30/100
      // bands describe nothing and `unfused` has to say so (#302). Reading only
      // the breaker was already blind to `vector-arm-empty`; the deadline makes
      // that blind spot common instead of rare, which is why it is fixed here.
      const hybridActiveAtRecall =
        search.hasEmbeddings() && !embeddingDegradedAtRecall && degradedReason === undefined;
      const weakResult = isWeakResult(hits, hybridActiveAtRecall);
      const noHome = isNoHome(hits, hybridActiveAtRecall);

      fireAndForget(
        telemetry.logHookRecall({
          recall_id: recallId,
          query,
          topics: Array.isArray(body.topics)
            ? (body.topics as unknown[]).filter((t): t is string => typeof t === "string")
            : [],
          tool_name: hookToolName,
          project: typeof body.project === "string" ? body.project : null,
          k,
          scope: scope ?? null,
          type: type ?? null,
          vault_size: vault.size(),
          hit_count: hits.length,
          top_score: hits[0]?.score ?? null,
          hits: hits.map((h) => ({ id: h.id, score: h.score, type: h.type })),
          latency_ms_recall: recallLatencyMs,
          latency_ms_total: totalLatencyMs,
          recall_stages: stageTimings,
          bridge_expansion:
            expansion.lang && expansion.added.length > 0 ? { lang: expansion.lang, added: expansion.added } : undefined,
          candidate_pool: candidatePool.length > 0 ? candidatePool : undefined,
          content_recall: contentRecall,
          // #165: pre-recall festgehalten, siehe oben / recallHandler.
          embedding_degraded: embeddingDegradedAtRecall ? true : undefined,
          // #342: which arm dropped out, if one did.
          degraded_reason: degradedReason,
          // #217: would-be Salience-Reihenfolge (shadow-only).
          salience_shadow: computeSalienceShadow(
            hits,
            (id) => vault.get(id)?.fm as Record<string, unknown> | undefined,
          ),
          // #160: dieselbe Projektion für den Trust-Multiplikator. MUSS hier
          // stehen und nicht nur im MCP-Pfad: der Hook ist der häufigere
          // Aufrufer, und ein Shadow, der nur die Tool-Calls sieht, misst eine
          // Verteilung, die es so nicht gibt.
          trust_shadow:
            trustRankMode() === "shadow"
              ? computeTrustShadow(hits, (id) => usageForShadow(vault.root)[id])
              : undefined,
          // #249: recorded, not just returned. Without this the flag reads
          // zero in every stats run — not because recall is healthy, but
          // because nothing ever wrote it down.
          weak_result: weakResult || undefined,
          no_home: noHome || undefined,
        }),
      );

      // Lean projection (#50): the hook CLI only consumes lean fields, so we
      // never need to send matched_terms/mode/hop/topic_path over the wire.
      // Telemetry above already logged the full hits. #148: the hook scope
      // filter needs the one extra bit `matched_recall_when` (kept here only,
      // not in the shared toLeanHit — MCP recall stays the documented lean shape).
      // #249: the honesty flag has to reach THIS path above all. /hook/recall
      // writes <recall-hints> into the agent's context on every Bash and Edit,
      // and without the flag the formatters label pure noise as "Strong
      // matches" — the daemon computed the contradicting signal and simply did
      // not send it. Same computation as the MCP path, from the same module.
      const payload = {
        hits: hits.map((h) => ({ ...toLeanHit(h), matched_recall_when: h.matched_recall_when ?? false })),
        vault_size: vault.size(),
        latency_ms: totalLatencyMs,
        recall_id: recallId,
        ...(weakResult ? { weak_result: true } : {}),
        // #230: the stricter half travels the same wire. A strict subset of
        // weak_result, so a consumer that only knows weak_result is unaffected.
        ...(noHome ? { no_home: true } : {}),
        // #302: whether RRF ran at all. Without a vector arm there is no
        // fusion and no ceiling — raw BM25 is unbounded (top hits into six
        // digits on a real vault), so the 30/100 cuts describe nothing there.
        // The formatter has to say so rather than band an unbounded scale.
        // Same shape as the flags above: present only when it has something
        // to say, computed once from the value the honesty flags already use.
        ...(hybridActiveAtRecall ? {} : { unfused: true }),
        // #342: name the reason on the wire too. `unfused` says the bands do
        // not apply; this says why, so a slow machine degrading on every call
        // is distinguishable from embeddings being off — from the response
        // alone, without correlating against the telemetry log.
        ...(degradedReason ? { degraded: degradedReason } : {}),
      };
      if (wantsSse) {
        writeSseEvent(res, "done", payload);
        res.end();
      } else {
        sendJson(res, 200, payload);
      }
    })
    .catch((err: Error) => {
      if (wantsSse && !res.headersSent) {
        openSseHeaders(res);
      }
      if (wantsSse) {
        writeSseEvent(res, "error", { error: err.message });
        res.end();
      } else {
        sendJson(res, 400, { error: err.message });
      }
    });
}

// ─── SSE helpers ─────────────────────────────────────────────────

function openSseHeaders(res: ServerResponse): void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Disable Nagle for prompt event delivery on local connections.
  res.setHeader("X-Accel-Buffering", "no");
  res.writeHead(200);
  // First chunk forces headers to flush so curl/test clients see them
  // before the first stage event lands.
  res.write(":ok\n\n");
}

function writeSseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ─── /api/v1 dispatcher ──────────────────────────────────────────

interface DispatchCtx {
  toolDeps: ToolDeps;
  documentWriteEnabled: boolean;
  /** Echte CC-Session aus den Forwarder-Headern (#74); null = unbekannt. */
  ccSessionId?: string | null;
}

async function dispatchApi(
  tool: string,
  body: Record<string, unknown>,
  ctx: DispatchCtx,
): Promise<unknown | undefined> {
  const { toolDeps, documentWriteEnabled } = ctx;
  const { vault, search } = toolDeps;

  switch (tool) {
    case "recall":
      return await recallHandler(toolDeps, body);
    case "load_memory":
      return await loadMemoryHandler(toolDeps, body, { sessionId: ctx.ccSessionId ?? null });
    case "save_memory":
      return await saveMemoryHandler(toolDeps, body);
    case "archive_memory":
      return await archiveMemoryHandler(toolDeps, body);
    case "save_product_doc":
      return await saveProductDocHandler(toolDeps, body);

    // Floor-Registry (#141/#142). Bewusst KEIN neues MCP-Tool (Tool-Surface-
    // Disziplin) — Governance-Surfaces konsumieren die REST-API. Die
    // Invarianten (cap, affirm braucht affirmed_by+why, release-by-condition)
    // erzwingt floors.ts selbst; Fehler landen als 400 beim Caller.
    case "floors": {
      const memoryId = typeof body.memory_id === "string" ? body.memory_id : "";
      const condition = typeof body.condition === "string" ? body.condition : "";
      const reason = typeof body.reason === "string" ? body.reason : "";
      const scope = typeof body.scope === "string" && body.scope.trim() ? body.scope : undefined;
      const affirmedBy = typeof body.affirmed_by === "string" ? body.affirmed_by : undefined;
      const why = typeof body.why === "string" ? body.why : undefined;
      const entry = await addFloor({
        memory_id: memoryId,
        condition,
        reason,
        scope,
        affirmed_by: affirmedBy,
        why,
        // Carried only when this rewrite IS an affirm (#198).
        ...(typeof body.occurred_at === "string" ? { occurred_at: body.occurred_at } : {}),
      });
      return { ok: true, entry };
    }
    case "floors/release": {
      const condition = typeof body.condition === "string" ? body.condition : "";
      const released = await release(condition);
      return { released };
    }
    case "floors/affirm": {
      // #198: `occurred_at` is the queuing surface's intent time, carried
      // verbatim. Only the surface knows when the affirm was meant; a drain
      // after downtime replays the original time, not the write time. Absent
      // is legitimate — an inline affirm has no second clock.
      const occurredAt = typeof body.occurred_at === "string" ? body.occurred_at : undefined;
      const entry = await affirm(
        typeof body.memory_id === "string" ? body.memory_id : "",
        typeof body.affirmed_by === "string" ? body.affirmed_by : "",
        typeof body.why === "string" ? body.why : "",
        occurredAt !== undefined ? { occurredAt } : {},
      );
      return { ok: true, entry };
    }

    case "find_document": {
      const parsed = FindDocumentArgs.safeParse(body);
      if (!parsed.success) throw new Error(parsed.error.message);
      return findDocument(search, vault, parsed.data);
    }
    case "read_document": {
      const parsed = ReadDocumentArgs.safeParse(body);
      if (!parsed.success) throw new Error(parsed.error.message);
      const doc = readDocument(vault, parsed.data);
      if (!doc) throw new Error(`document not found: ${parsed.data.id}`);
      return doc;
    }
    case "open_document": {
      const parsed = OpenDocumentArgs.safeParse(body);
      if (!parsed.success) throw new Error(parsed.error.message);
      const result = await openDocument(vault, parsed.data);
      if ("ok" in result && !result.ok) {
        throw new Error(result.message);
      }
      return result;
    }

    case "save_document":
    case "recategorize_document":
    case "move_document": {
      if (!documentWriteEnabled) {
        throw new Error(
          `${tool} is a Pro feature — set BASTRA_DOCUMENT_WRITE=1 to enable.`,
        );
      }
      if (tool === "save_document") {
        const parsed = SaveDocumentArgs.safeParse(body);
        if (!parsed.success) throw new Error(parsed.error.message);
        return await saveDocument(vault, parsed.data);
      }
      if (tool === "recategorize_document") {
        const parsed = RecategorizeDocumentArgs.safeParse(body);
        if (!parsed.success) throw new Error(parsed.error.message);
        return await recategorizeDocument(vault, parsed.data);
      }
      const parsed = MoveDocumentArgs.safeParse(body);
      if (!parsed.success) throw new Error(parsed.error.message);
      return await moveDocument(vault, parsed.data);
    }
  }
  return undefined;
}

// ─── helpers ─────────────────────────────────────────────────────

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function sendCors(
  res: ServerResponse,
  origin: string | null,
  opts?: { allowPrivateNetwork?: boolean },
): void {
  // Nur spiegeln, wenn die Origin erlaubt ist (null = nicht erlaubt → kein
  // ACAO-Header, der Browser blockt die Response selbst). Vary: Origin, damit
  // Caches/Proxies die per-Origin-Antwort nicht über Origins hinweg vermischen.
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );
  res.setHeader("Access-Control-Max-Age", "600");
  // Private Network Access: Chrome verlangt bei einem Preflight von öffentlicher
  // HTTPS-Origin auf eine private/localhost-Ressource diesen Antwort-Header,
  // sonst blockt es den Call. Wird nur beim OPTIONS-Preflight gesetzt (Caller
  // entscheidet) und nur bei erlaubter Origin — konsistent mit dem ACAO-Header.
  if (opts?.allowPrivateNetwork && origin) {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  if (!res.headersSent) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(payload).toString());
  }
  res.writeHead(status);
  res.end(payload);
}

function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`body too large (>${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        resolve(parsed);
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", (err) => reject(err));
  });
}

function clampInt(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const i = Math.round(raw);
  return Math.min(max, Math.max(min, i));
}
