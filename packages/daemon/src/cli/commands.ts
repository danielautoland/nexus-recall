import { ADAPTERS, resolveTargets } from "./registry.js";
import { VERSION, formatStatus } from "./helpers.js";
import { ensureOllama } from "./ollama.js";
import { getEmbeddingProvider } from "../settings.js";
import type { InstallOpts, ParsedArgs } from "./types.js";

export function showHelp(): void {
  const supportedSurfaces = Object.keys(ADAPTERS).join(", ");
  process.stdout.write(`bastra ${VERSION} — install bastra-recall across AI clients

Usage:
  bastra                     Show status panel (version, update, daemon, vault)
  bastra <command> [surface] [options]

Commands:
  install <surface|all>      Register bastra-recall with the AI client
  uninstall <surface|all>    Remove the registration (skill is kept; it's shared)
  update                     brew upgrade (if brew-installed) + re-register +
                             daemon restart. Use this after pulling new code.
  config get <key>           Read a setting (e.g. update.mode)
  config set <key> <value>   Write a setting (update.mode = notify|auto|off)
  token [rotate]             Print the REST API token (mint on first use) for
                             browser/REST clients; 'rotate' issues a fresh one
  commons <enable|update|disable|status>
                             Bastra Commons: community-proven recipes as a
                             read-only second recall index (git-synced)
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
  --ollama                   Set up Ollama for semantic recall without asking (installs via Homebrew, downloads ~600 MB)
  --no-ollama                Skip the Ollama setup (semantic recall uses BM25 keyword search)
  --fix                      With doctor: repair non-ok surfaces (on 'all', won't set up ones never installed)
  --with-stop-hook           Install optional Stop save-eval hook
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
    withStopHook: false,
    staged: false,
    ollama: null,
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
    else if (a === "--with-stop-hook") result.withStopHook = true;
    else if (a === "--staged") result.staged = true;
    else if (a === "--ollama") result.ollama = "auto";
    else if (a === "--no-ollama") result.ollama = "skip";
    else if (a === "--vault") {
      result.vaultPath = argv[++i] ?? null;
    } else if (a.startsWith("--vault=")) {
      result.vaultPath = a.slice("--vault=".length);
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

export async function cmdInstall(args: ParsedArgs): Promise<number> {
  const targets = resolveTargets(args.surface);
  if ("error" in targets) {
    process.stderr.write(`error: ${targets.error}\n`);
    return 2;
  }

  // Ollama is a global concern (one daemon, one embedding engine), so it runs
  // once here — not per surface. An Ollama failure never fails the install:
  // surface registration is the job; semantic recall is an enhancement.
  const ollama = await ensureOllama({ dryRun: args.dryRun, mode: args.ollama });
  process.stdout.write(`→ semantic recall: ${ollama.message}\n\n`);

  const vaultPath = resolveVaultPath(args.vaultPath);
  const opts: InstallOpts = {
    dryRun: args.dryRun,
    vaultPath,
    force: args.yes,
    withStopHook: args.withStopHook,
  };

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
  return hadError ? 1 : 0;
}

export async function cmdUninstall(args: ParsedArgs): Promise<number> {
  const targets = resolveTargets(args.surface);
  if ("error" in targets) {
    process.stderr.write(`error: ${targets.error}\n`);
    return 2;
  }

  let hadError = false;
  for (const adapter of targets) {
    process.stdout.write(`→ ${adapter.surface} (${adapter.description})\n`);
    process.stdout.write(`  config: ${adapter.configPath}\n`);
    try {
      const r = await adapter.uninstall({ dryRun: args.dryRun });
      process.stdout.write(`  ${formatStatus(r.status)}: ${r.message}\n`);
      if (r.backupPath) process.stdout.write(`  backup: ${r.backupPath}\n`);
      if (r.status === "error") hadError = true;
    } catch (err) {
      hadError = true;
      process.stdout.write(`  error: ${(err as Error).message}\n`);
    }
    process.stdout.write("\n");
  }

  // Ollama is global, not a surface. On a full uninstall, if bastra activated
  // it, the login service is still running — print a teardown hint (we don't
  // auto-stop: the user may run Ollama for other things).
  if (args.surface === "all" && (await getEmbeddingProvider()) === "ollama") {
    process.stdout.write(
      "→ semantic recall: Ollama stays configured and its login service may still run.\n" +
        "  Disable recall: bastra config set embedding.provider none\n" +
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
  return hadBroken ? 1 : 0;
}
