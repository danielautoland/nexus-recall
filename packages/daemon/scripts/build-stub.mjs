#!/usr/bin/env node
/**
 * build-stub.mjs — compile stub/bastra-hook.ts with deno (#344).
 *
 * One place for the permission flags: they are the stub's security contract
 * (loopback only, no arbitrary exec — `sh`/`ps` are what the skip gate and
 * the statusline need), and the release workflow compiles the same file once
 * per target (#350). Two package.json strings carrying the same flag list is
 * how they drift.
 *
 *   node scripts/build-stub.mjs                  # host binary → stub/bastra-hook
 *   node scripts/build-stub.mjs --target <t>     # cross-compile → stub/bastra-hook-<t>
 *
 * <t> is a deno target triple, e.g. aarch64-apple-darwin, x86_64-apple-darwin,
 * x86_64-unknown-linux-gnu, aarch64-unknown-linux-gnu. The statusline bundle
 * (packages/statusline/dist) must be built first — the stub embeds it.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const ti = args.indexOf("--target");
const target = ti >= 0 ? args[ti + 1] : null;
if (ti >= 0 && !target) {
  console.error("usage: node scripts/build-stub.mjs [--target <triple>]");
  process.exit(2);
}
const output = target ? `stub/bastra-hook-${target}` : "stub/bastra-hook";

const denoArgs = [
  "compile",
  ...(target ? ["--target", target] : []),
  // The stub has no npm dependencies — node: builtins and two local modules.
  // Without this flag deno sees the workspace package.json, switches to
  // bring-your-own-node_modules and embeds the whole node_modules tree: the
  // 168 MB binary #350 is named after carried ~108 MB of it, and a build on
  // a fuller checkout reached 723 MB. With it the binary is the deno runtime
  // plus ~150 KB of our code.
  "--no-npm",
  "--sloppy-imports",
  "--allow-net=127.0.0.1",
  "--allow-env",
  "--allow-read",
  "--allow-write",
  "--allow-sys",
  "--allow-run=sh,/bin/sh,ps",
  "--output", output,
  "stub/bastra-hook.ts",
];

const r = spawnSync("deno", denoArgs, { cwd: packageRoot, stdio: "inherit" });
if (r.error) {
  console.error(`error: could not run deno (${r.error.message}) — install it from https://deno.com`);
  process.exit(1);
}
process.exit(r.status ?? 1);
