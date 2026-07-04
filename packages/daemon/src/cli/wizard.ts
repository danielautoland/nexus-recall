/**
 * `bastra install` (no surface, on a terminal) — the guided setup wizard.
 *
 * Selection lists instead of y/n text prompts: vault location (create the
 * default or pick a folder), AI clients (multiselect, detected ones
 * preselected), semantic recall (enable / keyword-only). Built on
 * @clack/prompts; every prompt is cancellable (Ctrl-C → clean exit, nothing
 * written).
 *
 * The wizard is a front-end only: it collects choices, then drives the exact
 * same machinery as `bastra install all` (createVaultAt, adapter.install,
 * enableSemanticRecall) — no second install path. Scripted flows
 * (`install all`, `--yes`, non-TTY, `--dry-run`) never reach it; see
 * shouldRunWizard.
 */
import * as p from "@clack/prompts";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { ADAPTERS } from "./registry.js";
import {
  VERSION,
  resolveVault,
  defaultVaultPath,
  createVaultAt,
  DEFAULT_VAULT_DISPLAY,
  probeDaemon,
} from "./helpers.js";
import { RECALL_OFF_NOTE } from "./embeddings-cmd.js";
import { enableSemanticRecall } from "./ollama.js";
import { resolveEmbeddingChoice } from "../settings.js";
import type { InstallResult, ParsedArgs } from "./types.js";

/**
 * Pure gate — exported for tests. The wizard replaces the bare-`install`
 * "missing surface" error ONLY on an interactive terminal without automation
 * flags; every scripted invocation keeps today's deterministic behavior.
 */
export function shouldRunWizard(i: {
  surface: string | null;
  interactive: boolean;
  yes: boolean;
  dryRun: boolean;
}): boolean {
  return i.surface === null && i.interactive && !i.yes && !i.dryRun;
}

/** Filesystem traces that mean "this client exists on this machine". */
const SURFACE_TRACES: Record<string, string[]> = {
  "claude-code": [".claude.json", ".claude"],
  "claude-desktop": [
    "Library/Application Support/Claude",
    "/Applications/Claude.app",
  ],
  cursor: [".cursor", "/Applications/Cursor.app"],
};

export function detectSurfaces(home: string = homedir()): Record<string, boolean> {
  const present: Record<string, boolean> = {};
  for (const [surface, traces] of Object.entries(SURFACE_TRACES)) {
    present[surface] = traces.some((t) =>
      existsSync(isAbsolute(t) ? t : resolve(home, t)),
    );
  }
  return present;
}

export interface SurfaceChoice {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Pure options builder — exported for tests. Detected clients are
 * preselected; when nothing is detected (fresh machine, traces appear only
 * after first app launch) everything is preselected so plain-Enter still
 * yields a complete install.
 */
export function buildSurfaceChoices(present: Record<string, boolean>): {
  options: SurfaceChoice[];
  initialValues: string[];
} {
  const options = Object.entries(ADAPTERS).map(([surface, adapter]) => ({
    value: surface,
    label: adapter.description.replace(/\s*\(.*\)$/, ""),
    hint: present[surface] ? "detected" : "not detected",
  }));
  const detected = options.filter((o) => present[o.value]).map((o) => o.value);
  return { options, initialValues: detected.length > 0 ? detected : options.map((o) => o.value) };
}

/** `~`/relative → absolute, for the custom-vault text input. Exported for tests. */
export function expandUserPath(input: string, home: string = homedir()): string {
  const trimmed = input.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return resolve(home, trimmed.slice(2));
  return resolve(trimmed);
}

/**
 * Pure decision for the wizard's semantic-recall step — the wizard's analogue
 * of decideInstallRecallAction, same precedence (exported for tests):
 *   --ollama            → "on" (explicit flag = consent, never ask)
 *   provider effective or the running daemon is semantic → "already"
 *   --no-ollama         → "later" (explicit opt-out, never ask)
 *   otherwise           → "ask"
 */
export function decideWizardSemantic(i: {
  ollamaFlag: "auto" | "skip" | null;
  effectiveProvider: string;
  daemonSemanticOn: boolean;
}): "on" | "later" | "already" | "ask" {
  if (i.ollamaFlag === "auto") return "on";
  if (i.effectiveProvider !== "none" || i.daemonSemanticOn) return "already";
  if (i.ollamaFlag === "skip") return "later";
  return "ask";
}

function bailed(value: unknown): value is symbol {
  return p.isCancel(value);
}

const CANCEL_MSG = "Setup cancelled — nothing was changed.";

export async function runInstallWizard(args: ParsedArgs): Promise<number> {
  p.intro(`bastra-recall ${VERSION} — guided setup`);

  // ── 1. vault ──────────────────────────────────────────────────────────────
  // Same resolution order as every other path: --vault flag > env > detected
  // from an existing registration. Only a truly unconfigured machine is asked.
  let vaultPath: string | null = null;
  let vaultNeedsCreate = false;
  const preResolved = await resolveVault({ dryRun: false, vaultPath: args.vaultPath });
  if ("path" in preResolved) {
    vaultPath = preResolved.path;
    p.log.info(`Memory vault: ${vaultPath} (already configured)`);
  } else {
    const where = await p.select({
      message: "Where should your memories live? (plain markdown files you can read and back up)",
      options: [
        { value: "default", label: `Create ${DEFAULT_VAULT_DISPLAY}`, hint: "recommended" },
        { value: "custom", label: "Pick a custom folder…" },
      ],
      initialValue: "default",
    });
    if (bailed(where)) { p.cancel(CANCEL_MSG); return 1; }
    if (where === "default") {
      vaultPath = defaultVaultPath();
    } else {
      const custom = await p.text({
        message: "Vault folder (created if missing)",
        placeholder: DEFAULT_VAULT_DISPLAY,
        validate: (v) => (v && v.trim().length > 0 ? undefined : "enter a folder path"),
      });
      if (bailed(custom)) { p.cancel(CANCEL_MSG); return 1; }
      vaultPath = expandUserPath(custom);
      // Echo the expanded absolute path NOW — a typo ('~/Documets/…') or a
      // CWD-relative surprise must be visible before anything acts on it
      // (Ctrl-C on the next question still aborts with nothing written).
      p.log.info(`Vault folder: ${vaultPath}`);
    }
    vaultNeedsCreate = true;
  }

  // ── 2. clients ────────────────────────────────────────────────────────────
  const { options, initialValues } = buildSurfaceChoices(detectSurfaces());
  const chosen = await p.multiselect({
    message: "Which AI clients should get the memory tool? (space to toggle, enter to confirm)",
    options,
    initialValues,
    required: true,
  });
  if (bailed(chosen)) { p.cancel(CANCEL_MSG); return 1; }

  // ── 3. semantic recall ────────────────────────────────────────────────────
  // Same precedence as decideInstallRecallAction: --ollama/--no-ollama are
  // consent/opt-out and suppress the question; an already-effective provider
  // or a semantic RUNNING daemon (LaunchAgent env is invisible to this
  // shell) means there is nothing to ask.
  const choice = await resolveEmbeddingChoice();
  let daemonOn = false;
  if (args.ollama === null && choice.provider === "none") {
    try {
      const probe = await probeDaemon();
      daemonOn = probe.ok && probe.semanticRecall === "on";
    } catch { /* unreachable daemon = no signal */ }
  }
  let semantic = decideWizardSemantic({
    ollamaFlag: args.ollama,
    effectiveProvider: choice.provider,
    daemonSemanticOn: daemonOn,
  });
  if (semantic === "already") {
    p.log.info(
      choice.provider !== "none"
        ? `Semantic recall: already configured (${choice.provider}, source: ${choice.source})`
        : "Semantic recall: already ON in the running daemon",
    );
  } else if (semantic === "ask") {
    const answer = await p.select({
      message: "Semantic recall? (multilingual vector search on top of keyword search)",
      options: [
        {
          value: "on",
          label: "Enable — best recall quality",
          hint: "downloads the embeddinggemma model (~620 MB) via Ollama, installed with Homebrew if missing",
        },
        {
          value: "later",
          label: "Not now — keyword search only (BM25)",
          hint: "enable anytime: bastra embeddings on",
        },
      ],
      initialValue: "on",
    });
    if (bailed(answer)) { p.cancel(CANCEL_MSG); return 1; }
    semantic = answer as "on" | "later";
  }

  // ── execute ───────────────────────────────────────────────────────────────
  if (vaultNeedsCreate) {
    const created = await createVaultAt(vaultPath!);
    if ("error" in created) {
      p.log.error(`Could not create ${vaultPath}: ${created.error}`);
      p.outro("Setup failed — nothing else was changed.");
      return 1;
    }
    p.log.success(`Vault created: ${created.path}`);
  }

  const surfaces = chosen as string[];
  const results: { surface: string; r: InstallResult }[] = [];
  const s = p.spinner();
  s.start("Registering the memory tool…");
  let hadError = false;
  for (const surface of surfaces) {
    const adapter = ADAPTERS[surface];
    s.message(`Registering ${adapter.description}…`);
    try {
      const r = await adapter.install({
        dryRun: false,
        vaultPath,
        force: false,
        withStopHook: args.withStopHook,
      });
      results.push({ surface, r });
      if (r.status === "error") hadError = true;
    } catch (err) {
      results.push({ surface, r: { status: "error", message: (err as Error).message } });
      hadError = true;
    }
  }
  s.stop(hadError ? "Registration finished with errors" : "Clients registered");
  for (const { surface, r } of results) {
    const line = `${surface}: ${r.message}${r.backupPath ? ` (backup: ${r.backupPath})` : ""}`;
    if (r.status === "error") p.log.error(line);
    else p.log.success(line);
  }

  const restart = surfaces.map((sf) => ADAPTERS[sf].description.replace(/\s*\(.*\)$/, "")).join(", ");
  if (hadError) {
    // Same contract as the classic path: semantic recall runs only at the end
    // of a SUCCESSFUL install — never bolt a ~620 MB download onto a failure.
    if (semantic === "on") {
      p.log.warn("Skipping semantic recall setup (registration failed) — after fixing, run: bastra embeddings on");
    }
    p.outro(`Finished with errors — fix the issue, then re-run: bastra install (log lines above)`);
    return 1;
  }

  if (semantic === "on") {
    // No spinner here on purpose: brew/ollama stream their own progress to
    // stdout (a ~620 MB download deserves a real progress bar, not a spinner).
    p.log.step("Setting up semantic recall — Ollama + embeddinggemma model (~620 MB)…");
    const r = await enableSemanticRecall({ dryRun: false });
    if (r.status === "error" || r.status === "unsupported") {
      p.log.warn(`${r.message}\nSetting saved — finish setup, then re-run: bastra embeddings on`);
    } else if (r.activated) {
      p.log.success(`Semantic recall: ${r.message}`);
    } else {
      // e.g. "env-override": nothing was provisioned — a green success here
      // would misreport a state where recall stays keyword-only.
      p.log.warn(`Semantic recall: ${r.message}`);
    }
  } else if (semantic === "later") {
    p.log.info(RECALL_OFF_NOTE);
  }
  p.outro(`Done. Restart ${restart} to pick up the memory tool.`);
  return 0;
}
