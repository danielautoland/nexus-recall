/**
 * Shared exec hardening for CLI spawns (#91, lifted out of ollama.ts / #79).
 *
 * Every external command the CLI runs should (a) resolve to an absolute,
 * non-world-writable path via findExecutable() — never a bare name — and
 * (b) carry a hard timeout so unattended runs (e.g. `bastra update --staged`
 * spawned from the SessionStart hook) can never hang unbounded.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export interface RunResult {
  ok: boolean;
  signal: boolean;
  detail: string;
}

/**
 * spawnSync with a hard timeout and a closed stdin. stdin:"ignore" means a
 * brew sudo prompt fails fast instead of hanging a non-interactive run.
 */
export function run(bin: string, args: string[], opts: { timeoutMs: number; showProgress?: boolean }): RunResult {
  const r = spawnSync(bin, args, {
    stdio: opts.showProgress ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
    timeout: opts.timeoutMs,
  });
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code;
    return { ok: false, signal: false, detail: code === "ETIMEDOUT" ? `timed out after ${opts.timeoutMs}ms` : r.error.message };
  }
  if (r.signal) return { ok: false, signal: true, detail: `killed by ${r.signal}` };
  if (r.status !== 0) return { ok: false, signal: false, detail: `exit ${r.status}` };
  return { ok: true, signal: false, detail: "ok" };
}

/**
 * Resolve a command to an absolute, executable, non-world-writable path.
 * Augments PATH with the Homebrew bin dirs because GUI/hook-spawned processes
 * inherit a stripped PATH (the #79 root cause). Spawning the resolved absolute
 * path — never the bare name — keeps detection and execution in agreement and
 * closes the PATH-hijack vector.
 */
export function findExecutable(name: string): string | null {
  const me = process.getuid?.() ?? -1;
  const pathDirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  const dirs = [...pathDirs, "/opt/homebrew/bin", "/usr/local/bin"];
  const seen = new Set<string>();
  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    // Never resolve against CWD: a relative PATH entry (".", "x/bin") would make
    // join() return a relative path and spawn an attacker's ./ollama. Absolute only.
    if (!isAbsolute(dir)) continue;
    const full = join(dir, name);
    try {
      // A world-writable dir — or a group-writable one not owned by root/us —
      // lets an attacker swap the binary; skip it (mirrors the repo's temp-file
      // hardening, commit 3af0cc8).
      const dirSt = statSync(dir);
      if (dirSt.mode & 0o002) continue;
      if (dirSt.mode & 0o020 && dirSt.uid !== 0 && dirSt.uid !== me) continue;
      accessSync(full, constants.X_OK);
      if (statSync(full).mode & 0o002) continue; // reject world-writable binary
      return full;
    } catch {
      /* not here — try next */
    }
  }
  return null;
}
