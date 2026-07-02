import { probeDaemon, formatStatus, type DaemonProbe } from "./helpers.js";
import { ADAPTERS } from "./registry.js";
import { probeOllama } from "./ollama.js";
import { getEmbeddingProvider, getApiToken, type EmbeddingProviderName } from "../settings.js";

interface StatusOptions {
  json?: boolean;
  quiet?: boolean;
}

interface StatusResult {
  daemon: { status: string; message: string };
  semanticRecall: { configured: string; active: string; detail: string };
  apiToken: { set: boolean };
  surfaces: Record<string, { status: string; message: string }>;
}

function printLine(message: string) {
  process.stdout.write(message + "\n");
}

export async function cmdStatus(options: StatusOptions): Promise<number> {
  let hasError = false;

  const statusResult: StatusResult = {
    daemon: { status: "unknown", message: "" },
    semanticRecall: { configured: "unset", active: "unknown", detail: "" },
    apiToken: { set: false },
    surfaces: {},
  };

  const daemonInfo = await probeDaemon();
  if (daemonInfo.ok) {
    statusResult.daemon = { status: "ok", message: daemonInfo.detail };
    if (!options.quiet && !options.json) {
      printLine(`${"daemon".padEnd(15)} ${formatStatus("ok")}: ${daemonInfo.detail}`);
    }
  } else {
    hasError = true;
    statusResult.daemon = { status: "error", message: daemonInfo.detail };
    if (!options.quiet && !options.json) {
      printLine(`${"daemon".padEnd(15)} ${formatStatus("error")}: ${daemonInfo.detail}`);
    }
  }

  // Semantic recall — daemon-level + global, so one line (not per adapter).
  // It NEVER flips the exit code: BM25-only is degraded, not broken.
  const configured = await getEmbeddingProvider();
  const srDetail = await formatSemanticRecall(configured, daemonInfo);
  statusResult.semanticRecall = {
    configured: configured ?? "unset",
    active: daemonInfo.semanticRecall ?? "unknown",
    detail: srDetail,
  };
  if (!options.quiet && !options.json) {
    printLine(`${"semantic recall".padEnd(15)} ${srDetail}`);
  }

  // REST API token — local setting, never shows the token itself. "not set" is
  // the secure default (loopback-only); a set token enables browser/REST clients.
  // Never flips the exit code.
  const tokenSet = (await getApiToken()) !== undefined;
  statusResult.apiToken = { set: tokenSet };
  if (!options.quiet && !options.json) {
    printLine(
      `${"api token".padEnd(15)} ${tokenSet ? "✓ set (browser/REST enabled)" : "· not set (loopback only)"}`,
    );
  }

  for (const [name, adapter] of Object.entries(ADAPTERS)) {
    try {
      const r = await adapter.doctor();

      statusResult.surfaces[name] = { status: r.status, message: r.message };

      if (!options.quiet && !options.json) {
        printLine(`${name.padEnd(15)} ${formatStatus(r.status)}: ${r.message}`);
      }

      if (r.status === "broken") {
        hasError = true;
      }
    } catch (err) {
      hasError = true;
      const errMsg = (err as Error).message;
      statusResult.surfaces[name] = { status: "error", message: errMsg };
      if (!options.quiet && !options.json) {
        printLine(`${name.padEnd(15)} ${formatStatus("error")}: failed to check: ${errMsg}`);
      }
    }
  }

  // --json wins over --quiet so "machine-readable, no human noise" (-q --json)
  // still emits the JSON payload, not just an exit code.
  if (options.json) {
    printLine(JSON.stringify(statusResult, null, 2));
  }

  return hasError ? 1 : 0;
}

/**
 * Reconciles the *configured* provider (cli-settings) with the *active* one
 * (live /health). Distinguishes the drift classes so a just-installed user
 * isn't alarmed by a scary ✗, and so the env-override footgun is diagnosable.
 */
async function formatSemanticRecall(configured: EmbeddingProviderName | undefined, d: DaemonProbe): Promise<string> {
  if (!d.ok) {
    // Daemon down → can't read the active mode. If ollama is configured, probe
    // it directly so "installed but daemon down" vs "model missing" is visible.
    if (configured === "ollama") {
      const o = await probeOllama();
      const detail = o.ok ? (o.hasModel ? "ollama ready" : "model embeddinggemma MISSING — fix: bastra embeddings on") : o.detail;
      return `· daemon not reachable; configured=ollama (${detail})`;
    }
    return `· daemon not reachable; configured=${configured ?? "unset"}`;
  }
  const active = d.semanticRecall;
  if (active === undefined) return "· (daemon predates this field — restart it to report)";
  if (active === "on") {
    // /health reports "on" from the configured provider — but verify Ollama is
    // actually reachable + the model pulled, else recall silently degrades to
    // BM25 at runtime and "✓ on" would be a lie.
    if ((d.embeddingMode ?? "").startsWith("ollama")) {
      const o = await probeOllama();
      if (o.ok && !o.hasModel) {
        return `⚠ on (${d.embeddingMode}) but the embeddinggemma model is MISSING — recall falls back to BM25. Fix: bastra embeddings on`;
      }
      if (!o.ok) {
        return `⚠ on (${d.embeddingMode}) but Ollama is unreachable (${o.detail}) — recall falls back to BM25`;
      }
    }
    return `✓ on (${d.embeddingMode ?? "?"}${d.embeddingSource ? `, source: ${d.embeddingSource}` : ""})`;
  }
  if (active === "degraded") {
    // Daemon-side runtime health (#92): the last provider call failed after
    // boot (model deleted / server died) — recall is silently BM25-only.
    const why = d.embeddingError ? ` — last error: ${d.embeddingError}` : "";
    return `⚠ degraded (${d.embeddingMode ?? "?"})${why} — recall falls back to BM25. Check: ollama list / ollama serve`;
  }
  // active is off
  if (configured === "ollama") {
    if (d.embeddingSource === "env") {
      return "· off — BASTRA_EMBEDDING_PROVIDER (env) overrides your config=ollama; unset it";
    }
    return "· off — configured=ollama, daemon hasn't picked it up yet; restart pending (restart your AI client, or auto after idle)";
  }
  return "· off — BM25 keyword search only. Enable: bastra embeddings on";
}
