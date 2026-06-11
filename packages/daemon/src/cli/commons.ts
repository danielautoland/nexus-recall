/**
 * `bastra commons` — Bastra Commons, der Community-Rezept-Vault.
 *
 * Git-first: `enable` clont (bzw. pullt) das Commons-Repo nach
 * ~/.bastra/commons und setzt `commons.enabled` in cli-settings.json; der
 * Daemon lädt das Verzeichnis beim nächsten Boot als read-only BM25-Index
 * und fusioniert Treffer (scope "commons") in recall — leicht unter den
 * persönlichen Memories gerankt. Es wird NIE in das Repo geschrieben;
 * Beiträge laufen über PRs (siehe Commons-CONTRIBUTING).
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findExecutable, run } from "./exec.js";
import { getCommonsEnabled, setCommonsEnabled } from "../settings.js";

export const COMMONS_REPO_URL = process.env.BASTRA_COMMONS_REPO ?? "https://github.com/n0mad-ai/bastra-commons.git";

export function commonsPath(): string {
  return process.env.BASTRA_COMMONS_PATH ?? join(homedir(), ".bastra", "commons");
}

export async function cmdCommons(opts: { sub: string | null }): Promise<number> {
  const sub = opts.sub ?? "status";
  switch (sub) {
    case "enable": {
      const rc = await cloneOrPull();
      if (rc !== 0) return rc;
      await setCommonsEnabled(true);
      process.stdout.write("✓ commons enabled — restart the daemon (or your AI client) to load it\n");
      return 0;
    }
    case "update": {
      if (!existsSync(commonsPath())) {
        process.stdout.write("commons not cloned yet — run 'bastra commons enable' first\n");
        return 1;
      }
      return await cloneOrPull();
    }
    case "disable": {
      await setCommonsEnabled(false);
      process.stdout.write("✓ commons disabled (clone kept at " + commonsPath() + ") — restart the daemon to apply\n");
      return 0;
    }
    case "status": {
      const enabled = await getCommonsEnabled();
      const cloned = existsSync(join(commonsPath(), "recipes"));
      process.stdout.write(`commons: ${enabled ? "enabled" : "disabled"} · clone: ${cloned ? commonsPath() : "not cloned"}\n`);
      return 0;
    }
    default:
      process.stderr.write(`unknown commons subcommand '${sub}' — use enable|update|disable|status\n`);
      return 2;
  }
}

async function cloneOrPull(): Promise<number> {
  const git = findExecutable("git");
  if (!git) {
    process.stderr.write("✗ git not found on a trusted PATH\n");
    return 1;
  }
  const path = commonsPath();
  if (existsSync(join(path, ".git"))) {
    process.stdout.write(`→ updating commons (${path})\n`);
    const r = run(git, ["-C", path, "pull", "--ff-only"], { timeoutMs: 120_000, showProgress: true });
    if (!r.ok) {
      process.stderr.write(`✗ git pull failed (${r.detail})\n`);
      return 1;
    }
  } else {
    process.stdout.write(`→ cloning ${COMMONS_REPO_URL} → ${path}\n`);
    const r = run(git, ["clone", "--depth", "1", COMMONS_REPO_URL, path], { timeoutMs: 300_000, showProgress: true });
    if (!r.ok) {
      process.stderr.write(`✗ git clone failed (${r.detail}) — is the repo reachable for your account?\n`);
      return 1;
    }
  }
  process.stdout.write("✓ commons up to date\n");
  return 0;
}
