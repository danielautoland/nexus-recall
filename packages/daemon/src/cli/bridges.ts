/**
 * `bastra bridges` — the shared learned-recall layer (#120).
 *
 * Mirrors `bastra commons`: opt-in, git-synced, PR-gated, pseudonymous. A bridge
 * is a language-tagged vocabulary-expansion rule (see learned-recall/bridges.ts);
 * the daemon loads a language-partitioned, read-only pool from ~/.bastra/learned-recall
 * and uses it to widen recall queries. It is NEVER written by the daemon; sharing
 * goes through PRs.
 *
 * Safety/local-first: the contribution remote is UNSET by default
 * (BASTRA_BRIDGES_REPO). With no remote, `enable` still works (local pool only,
 * nothing leaves the machine) and `contribute` refuses — there is no auto-egress.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  getSharedRecallEnabled,
  setSharedRecallEnabled,
  getSharedRecallLanguage,
  setSharedRecallLanguage,
  clearSharedRecallLanguage,
} from "../settings.js";
import { findExecutable, run } from "./exec.js";
import { BridgePool } from "../learned-recall/bridges.js";
import { isSupportedLanguage, SUPPORTED_LANGUAGES } from "../learned-recall/language.js";

/** Contribution remote. UNSET by default — the shared repo is not public yet, and
 *  an unset remote guarantees `enable` does zero network I/O. */
export const BRIDGES_REPO_URL = process.env.BASTRA_BRIDGES_REPO ?? "";

export function bridgesPath(): string {
  return process.env.BASTRA_BRIDGES_PATH ?? join(homedir(), ".bastra", "learned-recall");
}

export async function cmdBridges(opts: { sub: string | null; positional?: string[] }): Promise<number> {
  const sub = opts.sub ?? "status";
  switch (sub) {
    case "enable": {
      // If a remote is configured, sync it; otherwise enable the local-only pool.
      if (BRIDGES_REPO_URL) {
        const rc = await cloneOrPull();
        if (rc !== 0) {
          process.stderr.write("→ enable continues with the local pool; fix the remote and run 'bastra bridges update'\n");
        }
      }
      await setSharedRecallEnabled(true);
      const hasPool = existsSync(join(bridgesPath(), "bridges"));
      process.stdout.write(
        `✓ shared learned-recall enabled — restart the daemon to load it\n` +
          (hasPool ? "" : "  note: the bridge pool is empty until a bridges repo is cloned; recall is unchanged for now\n"),
      );
      return 0;
    }
    case "disable": {
      await setSharedRecallEnabled(false);
      process.stdout.write("✓ shared learned-recall disabled (local pool kept at " + bridgesPath() + ") — restart the daemon to apply\n");
      return 0;
    }
    case "update": {
      if (!BRIDGES_REPO_URL) {
        process.stdout.write("no contribution remote configured (set BASTRA_BRIDGES_REPO) — nothing to update\n");
        return 0;
      }
      if (!existsSync(join(bridgesPath(), ".git"))) {
        process.stdout.write("bridges repo not cloned yet — run 'bastra bridges enable' first\n");
        return 1;
      }
      return await cloneOrPull();
    }
    case "language": {
      const lang = opts.positional?.[2] ?? null;
      if (!lang) {
        const cur = await getSharedRecallLanguage();
        process.stdout.write(`query-language override: ${cur ?? "(auto-detect)"}\n`);
        return 0;
      }
      if (lang === "auto") {
        // Remove the language key entirely (a plain enabled-rewrite would keep it).
        await clearSharedRecallLanguage();
        process.stdout.write("✓ query-language override cleared — auto-detect per query\n");
        return 0;
      }
      // Validate against the SAME set the daemon enforces at boot (SUPPORTED_LANGUAGES),
      // so the CLI never confirms an override the daemon would silently discard.
      if (!isSupportedLanguage(lang.toLowerCase())) {
        process.stderr.write(`✗ unsupported language '${lang}' — bridge pools exist only for: ${SUPPORTED_LANGUAGES.join(", ")} (or 'auto' to clear)\n`);
        return 2;
      }
      await setSharedRecallLanguage(lang);
      process.stdout.write(`✓ query-language override set to '${lang.toLowerCase()}'\n`);
      return 0;
    }
    case "contribute": {
      if (!BRIDGES_REPO_URL) {
        process.stderr.write(
          "✗ no contribution remote configured — set BASTRA_BRIDGES_REPO. Contribution is opt-in and PR-gated; nothing is shared automatically.\n",
        );
        return 1;
      }
      // The scrub + PR submission flow lands here once the shared repo is live.
      // Deliberately not wired to auto-run: bridges are mined locally and only
      // leave the machine through an explicit, reviewed PR.
      process.stderr.write("contribute: not yet available — the shared bridges repo is not public yet\n");
      return 1;
    }
    case "status": {
      const enabled = await getSharedRecallEnabled();
      const langOverride = await getSharedRecallLanguage();
      // Honor the same gate as the daemon (index.ts): when disabled, the pool is
      // never built — so status must not imply a live pool either.
      const pool = enabled ? BridgePool.load(bridgesPath()) : null;
      const poolStr = pool
        ? `${pool.size()} bridges (${pool.languages().map((l) => `${l}:${pool.size(l)}`).join(" ") || "none"})`
        : "(not loaded — disabled)";
      process.stdout.write(
        `shared learned-recall: ${enabled ? "enabled" : "disabled"} · language: ${langOverride ?? "auto"} · ` +
          `pool: ${poolStr} · path: ${bridgesPath()} · remote: ${BRIDGES_REPO_URL || "(none)"}\n`,
      );
      return 0;
    }
    default:
      process.stderr.write(`unknown bridges subcommand '${sub}' — use enable|disable|update|language|status|contribute\n`);
      return 2;
  }
}

async function cloneOrPull(): Promise<number> {
  const git = findExecutable("git");
  if (!git) {
    process.stderr.write("✗ git not found on a trusted PATH\n");
    return 1;
  }
  const path = bridgesPath();
  if (existsSync(join(path, ".git"))) {
    process.stdout.write(`→ updating bridges (${path})\n`);
    const r = run(git, ["-C", path, "pull", "--ff-only"], { timeoutMs: 120_000, showProgress: true });
    if (!r.ok) {
      process.stderr.write(`✗ git pull failed (${r.detail})\n`);
      return 1;
    }
  } else {
    process.stdout.write(`→ cloning ${BRIDGES_REPO_URL} → ${path}\n`);
    const r = run(git, ["clone", "--depth", "1", BRIDGES_REPO_URL, path], { timeoutMs: 300_000, showProgress: true });
    if (!r.ok) {
      process.stderr.write(`✗ git clone failed (${r.detail}) — is the repo reachable for your account?\n`);
      return 1;
    }
  }
  process.stdout.write("✓ bridges up to date\n");
  return 0;
}
