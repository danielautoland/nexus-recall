import { ADAPTERS, resolveTargets } from "./registry.js";
import {
  VERSION,
  formatStatus,
  resolveVault,
  decideFirstRunVaultAction,
  defaultVaultPath,
  createVaultAt,
  DEFAULT_VAULT_DISPLAY,
  VAULT_REQUIRED_ERROR,
} from "./helpers.js";
import { installSemanticRecallStep, printEmbeddingDoctorNote } from "./embeddings-cmd.js";
import { sweepSharedSkill } from "./skill.js";
import { removeRuntimeBase } from "./stable-runtime.js";
import { runInstallWizard, shouldRunWizard } from "./wizard.js";
import { confirm, isInteractive } from "./prompt.js";
import { getEmbeddingProvider } from "../settings.js";
import type { InstallOpts, ParsedArgs } from "./types.js";

export function showHelp(): void {
  const supportedSurfaces = Object.keys(ADAPTERS).join(", ");
  process.stdout.write(`bastra ${VERSION} — install bastra-recall across AI clients

Usage:
  bastra                     Show status panel (version, update, daemon, vault)
  bastra <command> [surface] [options]

Commands:
  install                    Guided setup (interactive): pick vault, clients,
                             semantic recall from selection lists
  install <surface|all>      Register bastra-recall with the AI client
  uninstall <surface|all>    Remove the registration (the shared skill is
                             removed once no surface references it anymore)
  update                     brew upgrade (if brew-installed) + re-register +
                             daemon restart. Use this after pulling new code.
  embeddings <on|off|status> Semantic recall (multilingual vector search):
                             'on' sets up Ollama + the embeddinggemma model
                             (~620 MB) and persists the choice; 'off' returns
                             to BM25 keyword-only; 'status' shows the effective
                             provider and how it was resolved
  models [status|recommend|  Local text model for memory rewriting (doc2query +
    set <tag>]               rerank). 'status' shows the active model + this
                             machine's RAM-tier recommendation; 'set' pulls a
                             model + persists it (e.g. gemma4:12b on a 24 GB+ box)
  config get <key>           Read a setting (e.g. update.mode)
  config set <key> <value>   Write a setting (update.mode = notify|auto|off,
                             docs.mode = off|suggest|auto, docs.language = en|de|…)
  token [rotate|clear]       Print the REST API token (mint on first use) for
                             browser/REST clients; 'rotate' issues a fresh one,
                             'clear' removes it (locks out browser/REST clients)
    [--origin <url>]         With 'token': also allowlist this browser Origin
                             (e.g. https://bastra.io) so the web app can reach
                             the daemon — no plist/env editing needed
  commons <enable|update|disable|status>
                             Bastra Commons: community-proven recipes as a
                             read-only second recall index (git-synced)
  bridges <enable|disable|status|language|mint|harvest>
                             Shared learned-recall: opt-in, language-partitioned
                             vocabulary bridges that widen recall (off by default).
                             'mint' = bridges from acted-on reaches; 'harvest' =
                             deep far-slice pass with the local reranker (Teacher 2).
  map                        Open the vault map in the browser — an interactive
                             graph of your memory (local only; offers to enable
                             it when off). Alias: ui
  import <file|-> [source]   Seed the vault from another AI tool's memories
                             (ChatGPT/Claude/Gemini list or free text): stages
                             candidates in import-review.md for review — your
                             next AI session distills accepted ones with you;
                             nothing is saved without your accept.
                             A conversations.json data export is queued locally
                             instead; the AI session mines it chunk-wise
  import rules               Stage local rules files (CLAUDE.md, AGENTS.md,
                             .cursorrules, .cursor/rules/, ~/.claude/CLAUDE.md)
  import <mine|clear>        Print the next mining chunk for the AI session /
                             discard the local mining queue
  feedback <bug|idea>        Open a prefilled GitHub issue form in the browser.
                             'bug' includes a sanitized diagnostics block
                             (version, OS, embedding mode, vault size — never
                             vault content); you review and submit it yourself
  doctor [surface|all]       Check status of one or every surface
  doctor [surface|all] --fix Check status and repair missing/broken pieces
  status                     Check daemon and adapters status (supports --json, -q)
  help                       Show this help
  version                    Show version

Surfaces:
  claude-desktop             Claude Desktop App
  claude-code                Claude Code
  cursor                     Cursor
  all                        Every surface above

Options:
  --dry-run                  Print what would change; write nothing
  --vault <path>             Vault path (BASTRA_VAULT_PATH env also works)
  --json                     Output status in JSON format (status command only)
  -q, --quiet                Suppress output, return exit code only (status command only)
  --yes, -y                  Skip confirmation prompts (replace a foreign statusLine)
  --ollama                   Set up Ollama for semantic recall without asking (installs via Homebrew, downloads ~620 MB)
  --no-ollama                Skip the Ollama setup (semantic recall uses BM25 keyword search)
  --fix                      With doctor: repair non-ok surfaces (on 'all', won't set up ones never installed)
  --no-stop-hook             Skip the Stop save-eval hook (registered by default)
  --help, -h                 Show this help
  --version, -v              Show version

Examples:
  bastra install claude-desktop
  bastra install all --dry-run
  bastra status --json
  bastra doctor
  bastra uninstall claude-desktop

Supported surfaces (this build): ${supportedSurfaces}
`);
}

export function showVersion(): void {
  process.stdout.write(`${VERSION}\n`);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    command: null,
    surface: null,
    dryRun: false,
    vaultPath: null,
    showHelp: false,
    showVersion: false,
    json: false,
    quiet: false,
    yes: false,
    fix: false,
    // Stop save-eval hook is registered by default since #48 (live-validated,
    // silent file-relay — no chat noise). Opt out with --no-stop-hook.
    withStopHook: true,
    staged: false,
    ollama: null,
    origin: null,
    positional: [],
  };

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") result.showHelp = true;
    else if (a === "--version" || a === "-v") result.showVersion = true;
    else if (a === "--dry-run") result.dryRun = true;
    else if (a === "--json") result.json = true;
    else if (a === "-q" || a === "--quiet") result.quiet = true;
    else if (a === "--yes" || a === "-y") result.yes = true;
    else if (a === "--fix") result.fix = true;
    else if (a === "--with-stop-hook") result.withStopHook = true; // kept for compat — now the default
    else if (a === "--no-stop-hook") result.withStopHook = false;
    else if (a === "--staged") result.staged = true;
    else if (a === "--ollama") result.ollama = "auto";
    else if (a === "--no-ollama") result.ollama = "skip";
    else if (a === "--vault") {
      result.vaultPath = argv[++i] ?? null;
    } else if (a.startsWith("--vault=")) {
      result.vaultPath = a.slice("--vault=".length);
    } else if (a === "--origin") {
      result.origin = argv[++i] ?? null;
    } else if (a.startsWith("--origin=")) {
      result.origin = a.slice("--origin=".length);
    } else if (a.startsWith("--")) {
      process.stderr.write(`warning: unknown flag '${a}' ignored\n`);
    } else {
      positional.push(a);
    }
  }

  result.command = positional[0] ?? null;
  result.surface = positional[1] ?? null;
  result.positional = positional;
  return result;
}

function resolveVaultPath(cliVault: string | null): string | null {
  return cliVault ?? process.env.BASTRA_VAULT_PATH ?? null;
}

export const FIRST_RUN_VAULT_QUESTION =
  `No memory vault configured yet. Create one at ${DEFAULT_VAULT_DISPLAY}?`;

/**
 * First-run vault step (#178): on a fresh machine there is nothing to
 * auto-detect, so without this the headline onboarding command errors once
 * per surface. Runs ONCE before the per-surface loop. Returns the created
 * vault path (the caller feeds it through opts.vaultPath — the same route a
 * --vault value takes), or an exit code when install must stop (refusal or
 * failed creation → the unchanged non-zero error semantics). `io` is
 * injectable for tests only (there is no TTY on CI).
 */
export async function installVaultFirstRunStep(
  i: { vaultConfigured: boolean; interactive: boolean; yes: boolean; dryRun: boolean },
  io: {
    ask?: (question: string, opts: { defaultYes?: boolean }) => Promise<boolean>;
    create?: (path: string) => Promise<{ path: string } | { error: string }>;
  } = {},
): Promise<{ vaultPath: string | null; exit: number | null }> {
  const action = decideFirstRunVaultAction(i);
  // "error" = non-TTY/--yes without a vault: do nothing here — the per-surface
  // loop reports today's deterministic error, so scripts see exactly what they
  // saw before.
  if (action === "proceed" || action === "error") return { vaultPath: null, exit: null };
  if (action === "would-create") {
    process.stdout.write(`~ would prompt to create ${DEFAULT_VAULT_DISPLAY} (dry-run): no vault configured yet\n\n`);
    return { vaultPath: null, exit: null };
  }
  // action === "prompt" — ask once, default Yes.
  const accepted = await (io.ask ?? confirm)(FIRST_RUN_VAULT_QUESTION, { defaultYes: true });
  if (!accepted) {
    process.stderr.write(`error: ${VAULT_REQUIRED_ERROR}\n`);
    return { vaultPath: null, exit: 1 };
  }
  const created = await (io.create ?? createVaultAt)(defaultVaultPath());
  if ("error" in created) {
    process.stderr.write(`✗ could not create ${DEFAULT_VAULT_DISPLAY}: ${created.error}\n`);
    process.stderr.write(`error: ${VAULT_REQUIRED_ERROR}\n`);
    return { vaultPath: null, exit: 1 };
  }
  process.stdout.write(`✓ created ${created.path} — your memories live here as plain markdown files\n\n`);
  return { vaultPath: created.path, exit: null };
}

export async function cmdInstall(args: ParsedArgs): Promise<number> {
  // `bastra install --help` must document, never act — without this it would
  // fall through to the wizard (TTY) or the missing-surface error (script).
  if (args.showHelp) {
    showHelp();
    return 0;
  }

  // Bare `bastra install` on a terminal → guided setup (selection lists for
  // vault, clients, semantic recall). Scripted invocations (a named surface,
  // --yes, --dry-run, non-TTY) never enter the wizard and keep the exact
  // pre-wizard behavior below.
  if (shouldRunWizard({ surface: args.surface, interactive: isInteractive(), yes: args.yes, dryRun: args.dryRun })) {
    return runInstallWizard(args);
  }

  const targets = resolveTargets(args.surface);
  if ("error" in targets) {
    process.stderr.write(`error: ${targets.error}\n`);
    return 2;
  }

  const vaultPath = resolveVaultPath(args.vaultPath);
  const opts: InstallOpts = {
    dryRun: args.dryRun,
    vaultPath,
    force: args.yes,
    withStopHook: args.withStopHook,
  };

  // First-run vault guard (#178) — before the loop, so the offer never
  // repeats per surface.
  const preResolve = await resolveVault(opts);
  const firstRun = await installVaultFirstRunStep({
    vaultConfigured: !("error" in preResolve),
    interactive: isInteractive(),
    yes: args.yes,
    dryRun: args.dryRun,
  });
  if (firstRun.exit !== null) return firstRun.exit;
  if (firstRun.vaultPath) opts.vaultPath = firstRun.vaultPath;

  let hadError = false;
  for (const adapter of targets) {
    process.stdout.write(`→ ${adapter.surface} (${adapter.description})\n`);
    process.stdout.write(`  config: ${adapter.configPath}\n`);
    try {
      const r = await adapter.install(opts);
      process.stdout.write(`  ${formatStatus(r.status)}: ${r.message}\n`);
      if (r.backupPath) process.stdout.write(`  backup: ${r.backupPath}\n`);
      if (r.status === "error") hadError = true;
    } catch (err) {
      hadError = true;
      process.stdout.write(`  error: ${(err as Error).message}\n`);
    }
    process.stdout.write("\n");
  }
  if (hadError) return 1;

  // Semantic recall is a global concern (one daemon, one embedding engine), so
  // it runs ONCE at the end of a successful install — not per surface (#79).
  // Prompts only on a TTY without --yes and only when no provider is effective;
  // an Ollama failure never fails the install: surface registration is the job.
  await installSemanticRecallStep({ dryRun: args.dryRun, yes: args.yes, ollama: args.ollama });
  return 0;
}

export async function cmdUninstall(args: ParsedArgs): Promise<number> {
  const targets = resolveTargets(args.surface);
  if ("error" in targets) {
    process.stderr.write(`error: ${targets.error}\n`);
    return 2;
  }

  let hadError = false;
  const succeededSurfaces: string[] = [];
  for (const adapter of targets) {
    process.stdout.write(`→ ${adapter.surface} (${adapter.description})\n`);
    process.stdout.write(`  config: ${adapter.configPath}\n`);
    try {
      const r = await adapter.uninstall({ dryRun: args.dryRun });
      process.stdout.write(`  ${formatStatus(r.status)}: ${r.message}\n`);
      if (r.backupPath) process.stdout.write(`  backup: ${r.backupPath}\n`);
      if (r.status === "error") hadError = true;
      if (r.status === "removed" || r.status === "would-remove" || r.status === "not-present") {
        succeededSurfaces.push(adapter.surface);
      }
    } catch (err) {
      hadError = true;
      process.stdout.write(`  error: ${(err as Error).message}\n`);
    }
    process.stdout.write("\n");
  }

  // The shared skill survives per-surface uninstalls by design; once the loop
  // leaves no surface registration referencing it, it's an orphan — sweep it
  // so a full uninstall leaves nothing behind (#181). Silent when kept or
  // already absent. Only surfaces whose uninstall SUCCEEDED enter the
  // decision — a failed one counts as still registered.
  const sweep = await sweepSharedSkill({ surface: args.surface, dryRun: args.dryRun, succeededSurfaces });
  if (sweep.status === "removed" || sweep.status === "would-remove") {
    process.stdout.write("→ skill (shared across Claude surfaces)\n");
    process.stdout.write(`  ${formatStatus(sweep.status)}: ${sweep.detail}\n\n`);
  }

  // Full uninstall: nothing references the pinned npx runtimes anymore —
  // remove ~/.bastra/runtime entirely (#180). Best-effort and silent when
  // absent; skipped when any surface errored (its registration may still
  // point into the runtime). A live daemon spawned from a runtime dir keeps
  // running via its open fds; the next install re-creates the dir.
  if (args.surface === "all" && !args.dryRun && !hadError && (await removeRuntimeBase())) {
    process.stdout.write("→ runtime (pinned npx runtime, ~/.bastra/runtime)\n");
    process.stdout.write(`  ${formatStatus("removed")}: no surface registration references it anymore\n\n`);
  }

  // Ollama is global, not a surface. On a full uninstall, if bastra activated
  // it, the login service is still running — print a teardown hint (we don't
  // auto-stop: the user may run Ollama for other things).
  if (args.surface === "all" && (await getEmbeddingProvider()) === "ollama") {
    process.stdout.write(
      "→ semantic recall: Ollama stays configured and its login service may still run.\n" +
        "  Disable recall: bastra embeddings off\n" +
        "  Stop the service: brew services stop ollama\n\n",
    );
  }
  return hadError ? 1 : 0;
}

export async function cmdDoctor(args: ParsedArgs): Promise<number> {
  const surface = args.surface ?? "all";
  // An explicitly named surface may be installed from scratch by --fix; on the
  // default 'all' we only repair surfaces that already exist, never silently
  // set up ones the user never asked for.
  const fixMissing = surface !== "all";
  const targets = resolveTargets(surface);
  if ("error" in targets) {
    process.stderr.write(`error: ${targets.error}\n`);
    return 2;
  }

  let hadBroken = false;
  for (const adapter of targets) {
    process.stdout.write(`→ ${adapter.surface} (${adapter.description})\n`);
    process.stdout.write(`  config: ${adapter.configPath}\n`);
    try {
      const r = await adapter.doctor();
      process.stdout.write(`  ${formatStatus(r.status)}: ${r.message}\n`);
      if (r.status === "broken" && !args.fix) hadBroken = true;
      if (r.details) {
        for (const [k, v] of Object.entries(r.details)) {
          process.stdout.write(`    ${k}: ${v}\n`);
        }
      }
      if (args.fix && r.status !== "ok" && (r.status !== "missing" || fixMissing)) {
        const fix = await adapter.install({
          dryRun: args.dryRun,
          vaultPath: resolveVaultPath(args.vaultPath),
          force: args.yes,
          withStopHook: args.withStopHook,
        });
        process.stdout.write(`  fix: ${formatStatus(fix.status)}: ${fix.message}\n`);
        if (fix.backupPath) process.stdout.write(`  backup: ${fix.backupPath}\n`);
        if (fix.status === "error" || fix.status === "not-implemented") hadBroken = true;
      }
    } catch (err) {
      hadBroken = true;
      process.stdout.write(`  error: ${(err as Error).message}\n`);
    }
    process.stdout.write("\n");
  }

  // Semantic recall is global, not a surface — reported as a NOTE (or an
  // actionable ⚠), never as a failure: BM25-only recall is degraded, not
  // broken, so it never flips doctor's exit code (#79).
  await printEmbeddingDoctorNote();

  return hadBroken ? 1 : 0;
}
