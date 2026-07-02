/**
 * `bastra embeddings <on|off|status>` — the discoverable switch for semantic
 * recall (#79). Recall stays BM25-by-default (the embedding layer is an
 * optional, configurable 2nd pass); this command makes turning it on a single
 * line instead of a hidden env/config dance.
 *
 *   on     persist embedding.provider=ollama, then provision (Homebrew install
 *          if missing, pull embeddinggemma ~620 MB, start login service).
 *          The setting survives a failed download — status/doctor then say
 *          "configured but model missing" instead of a silent none.
 *   off    persist embedding.provider=none (recall = BM25 keyword search only).
 *   status effective provider + WHERE it came from (env / cli-settings /
 *          API-key / default) + Ollama server & model presence.
 *
 * Also home of the install-end prompt (installSemanticRecallStep) and the
 * doctor note (printEmbeddingDoctorNote) so every surface points at the same
 * one-liner.
 */
import {
  getEmbeddingProvider,
  setEmbeddingProvider,
  resolveEmbeddingChoice,
  settingsFilePath,
  type EmbeddingChoice,
  type EmbeddingProviderName,
} from "../settings.js";
import { enableSemanticRecall, ensureOllama, probeOllama } from "./ollama.js";
import { confirm, isInteractive } from "./prompt.js";

const ENABLE_HINT = "bastra embeddings on";

/** The one OFF wording every surface shares (doctor, install hint, status). */
export const RECALL_OFF_NOTE = `Semantic recall is OFF — recall is keyword-only (BM25). Enable: ${ENABLE_HINT}`;
/** Same message behind the install step's "→ semantic recall:" prefix. */
const INSTALL_OFF_HINT = `→ semantic recall: OFF — recall is keyword-only (BM25). Enable: ${ENABLE_HINT}`;

export const INSTALL_PROMPT_QUESTION =
  "Enable semantic recall (multilingual vector search)? Downloads the embeddinggemma model (~620 MB) via Ollama (installed with Homebrew if missing).";

function write(line: string): void {
  process.stdout.write(line + "\n");
}

export async function cmdEmbeddings(opts: { sub: string | null; settingsPath?: string }): Promise<number> {
  switch (opts.sub) {
    case "on":
      return cmdOn(opts.settingsPath);
    case "off":
      return cmdOff(opts.settingsPath);
    case "status":
      return cmdStatus(opts.settingsPath);
    default:
      process.stderr.write("usage: bastra embeddings <on|off|status>\n");
      process.stderr.write(`  on      enable semantic recall (persists the setting + sets up Ollama/embeddinggemma)\n`);
      process.stderr.write(`  off     disable semantic recall (recall = BM25 keyword search only)\n`);
      process.stderr.write(`  status  show the effective provider, how it was resolved, and model presence\n`);
      return 2;
  }
}

async function cmdOn(settingsPath?: string): Promise<number> {
  const r = await enableSemanticRecall({ dryRun: false }, settingsPath);
  write(`✓ embedding.provider = ollama`);
  write(`  stored in ${settingsPath ?? settingsFilePath()}`);
  write(`→ semantic recall: ${r.message}`);
  if (r.status === "already-active") {
    write("  restart the daemon to apply (restart your AI client, or it applies on the next boot).");
  }
  if (r.status === "error" || r.status === "unsupported") {
    write("  setting saved — semantic recall turns ON once Ollama + the embeddinggemma model are ready;");
    write(`  recall stays keyword-only (BM25) until then. Finish setup, then re-run: ${ENABLE_HINT}`);
    return 1;
  }
  return 0;
}

async function cmdOff(settingsPath?: string): Promise<number> {
  await setEmbeddingProvider("none", settingsPath);
  write(`✓ embedding.provider = none`);
  write(`  stored in ${settingsPath ?? settingsFilePath()}`);
  write(`  semantic recall OFF — recall is keyword-only (BM25). Re-enable: ${ENABLE_HINT}`);
  const env = process.env.BASTRA_EMBEDDING_PROVIDER;
  if (env && env.toLowerCase() !== "none") {
    write(`  ⚠ BASTRA_EMBEDDING_PROVIDER=${env} (env) overrides this — unset it for the setting to take effect.`);
  }
  write("  restart the daemon to apply (activates on next boot).");
  return 0;
}

async function cmdStatus(settingsPath?: string): Promise<number> {
  const choice = await resolveEmbeddingChoice({ path: settingsPath });
  const fileProvider = await getEmbeddingProvider(settingsPath);
  const envRaw = process.env.BASTRA_EMBEDDING_PROVIDER;

  write(`effective provider: ${choice.provider}`);
  write(`  resolved via: ${sourceLabel(choice, fileProvider, envRaw, settingsPath)}`);

  if (choice.requested === "openai" && choice.provider === "none") {
    write("  ⚠ openai is requested but no API key is set (OPENAI_API_KEY / BASTRA_EMBEDDING_KEY) — falling back to none");
  }
  if (choice.source === "env" && fileProvider && envRaw && envRaw.toLowerCase() !== fileProvider) {
    write(`  note: BASTRA_EMBEDDING_PROVIDER=${envRaw} (env) overrides embedding.provider=${fileProvider} (cli-settings)`);
  }

  if (choice.provider === "ollama") {
    const o = await probeOllama();
    if (!o.ok) {
      write(`  ⚠ ${o.detail} — recall falls back to BM25. Fix: ${ENABLE_HINT}`);
    } else {
      write(`  ollama: ${o.detail}`);
      write(`  model embeddinggemma: ${o.hasModel ? "present" : `MISSING — recall falls back to BM25. Fix: ${ENABLE_HINT}`}`);
    }
  } else if (choice.provider === "none") {
    write(`  ${RECALL_OFF_NOTE}`);
  }
  return 0;
}

function sourceLabel(
  choice: EmbeddingChoice,
  fileProvider: EmbeddingProviderName | undefined,
  envRaw: string | undefined,
  settingsPath?: string,
): string {
  switch (choice.source) {
    case "env":
      return `BASTRA_EMBEDDING_PROVIDER=${envRaw} (env — wins over cli-settings)`;
    case "cli-settings":
      return `embedding.provider=${fileProvider} (${settingsPath ?? settingsFilePath()})`;
    case "api-key":
      return "OPENAI_API_KEY present, no explicit provider (backwards-compat)";
    case "none":
      return "default (nothing configured)";
  }
}

// ─── install-end prompt (#79) ────────────────────────────────────────────────

export type InstallRecallAction = "skip" | "provision" | "silent" | "prompt" | "hint";

/**
 * Pure decision for the end-of-install semantic-recall step — exported so the
 * TTY/--yes guards are unit-testable without a terminal:
 *   --ollama               → provision without asking (explicit flag = consent)
 *   provider already effective (env or setting) → silent — also under
 *                            --no-ollama (the flag skips provisioning, it
 *                            never disables anything, so there is nothing to
 *                            report; keeps `bastra update`'s hard-skip quiet)
 *   --no-ollama            → skip (one skip line)
 *   dry-run / --yes / non-TTY → hint line, NEVER a prompt (never hangs)
 *   otherwise              → ask once ([Y/n])
 */
export function decideInstallRecallAction(i: {
  ollamaFlag: "auto" | "skip" | null;
  effectiveProvider: EmbeddingProviderName;
  interactive: boolean;
  yes: boolean;
  dryRun: boolean;
}): InstallRecallAction {
  if (i.ollamaFlag === "auto") return "provision";
  if (i.effectiveProvider !== "none") return "silent";
  if (i.ollamaFlag === "skip") return "skip";
  if (i.dryRun || i.yes || !i.interactive) return "hint";
  return "prompt";
}

/** Runs at the END of a successful `bastra install` (never on a failed one). */
export async function installSemanticRecallStep(args: {
  dryRun: boolean;
  yes: boolean;
  ollama: "auto" | "skip" | null;
}): Promise<void> {
  const choice = await resolveEmbeddingChoice();
  const action = decideInstallRecallAction({
    ollamaFlag: args.ollama,
    effectiveProvider: choice.provider,
    interactive: isInteractive(),
    yes: args.yes,
    dryRun: args.dryRun,
  });

  if (action === "silent") return;
  if (action === "skip") {
    const r = await ensureOllama({ dryRun: args.dryRun, mode: "skip" });
    write(`→ semantic recall: ${r.message}`);
    return;
  }
  if (action === "hint") {
    write(INSTALL_OFF_HINT);
    return;
  }
  if (action === "prompt") {
    const accepted = await confirm(INSTALL_PROMPT_QUESTION, { defaultYes: true });
    if (!accepted) {
      write(INSTALL_OFF_HINT);
      return;
    }
  }
  // "provision", or the prompt was accepted — same path as `bastra embeddings on`.
  const r = await enableSemanticRecall({ dryRun: args.dryRun });
  write(`→ semantic recall: ${r.message}`);
  if (r.persisted && (r.status === "error" || r.status === "unsupported")) {
    write(`  setting saved — finish setup, then re-run: ${ENABLE_HINT}`);
  }
}

// ─── doctor note (#79) ───────────────────────────────────────────────────────

export interface OllamaProbeResult {
  ok: boolean;
  detail: string;
  hasModel: boolean;
}

/**
 * Pure formatter for the doctor's semantic-recall block (exported for tests).
 * A NOTE, never a failure — BM25-only is degraded, not broken, so doctor's
 * exit code is untouched.
 */
export function formatEmbeddingDoctorLines(i: {
  choice: EmbeddingChoice;
  fileProvider: EmbeddingProviderName | undefined;
  envValue: string | undefined;
  /** probeOllama() result when the effective provider is ollama, else null. */
  probe: OllamaProbeResult | null;
}): string[] {
  const lines: string[] = ["→ semantic recall"];
  const { choice } = i;

  if (choice.provider === "none") {
    lines.push(`  note: ${RECALL_OFF_NOTE}`);
    if (choice.requested === "openai") {
      lines.push(`  note: openai is requested (source: ${choice.source}) but no API key is set (OPENAI_API_KEY / BASTRA_EMBEDDING_KEY)`);
    }
  } else if (choice.provider === "ollama") {
    if (i.probe && !i.probe.ok) {
      lines.push(`  ⚠ configured (ollama, source: ${choice.source}) but ${i.probe.detail} — recall falls back to BM25. Fix: ${ENABLE_HINT}`);
    } else if (i.probe && !i.probe.hasModel) {
      lines.push(`  ⚠ configured (ollama, source: ${choice.source}) but the embeddinggemma model is missing — recall falls back to BM25. Fix: ${ENABLE_HINT}`);
    } else {
      lines.push(`  ✓ ok: ollama ${i.probe?.detail ?? "configured"}, model embeddinggemma present (source: ${choice.source})`);
    }
  } else {
    lines.push(`  ✓ ok: openai (source: ${choice.source})`);
  }

  if (
    i.envValue &&
    i.fileProvider &&
    i.envValue.toLowerCase() !== i.fileProvider
  ) {
    lines.push(`  note: BASTRA_EMBEDDING_PROVIDER=${i.envValue} (env) overrides embedding.provider=${i.fileProvider} (cli-settings)`);
  }
  return lines;
}

/** Doctor's semantic-recall block: gathers state, prints, never throws. */
export async function printEmbeddingDoctorNote(): Promise<void> {
  try {
    const choice = await resolveEmbeddingChoice();
    const fileProvider = await getEmbeddingProvider();
    const probe = choice.provider === "ollama" ? await probeOllama() : null;
    const lines = formatEmbeddingDoctorLines({
      choice,
      fileProvider,
      envValue: process.env.BASTRA_EMBEDDING_PROVIDER,
      probe,
    });
    for (const line of lines) write(line);
    write("");
  } catch {
    /* a diagnostics NOTE must never break doctor */
  }
}
