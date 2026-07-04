/**
 * Stable runtime for npx-based installs (#180).
 *
 * `npx …` runs this CLI out of the npm exec cache
 * (~/.npm/_npx/<hash>/node_modules/…). Registering FORWARDER_SCRIPT_PATH from
 * there plants a time bomb: npm evicts _npx entries at will, and every MCP
 * registration then points at a file that no longer exists. Fix: when install
 * detects it is running from an npx cache, it copies the resolved runtime to
 * ~/.bastra/runtime/<version>/ and registers THAT forwarder path.
 *
 * What gets copied: the cache's flat node_modules tree — the daemon package
 * plus exactly the production deps npx materialized. dist/ alone would NOT
 * suffice: the forwarder imports @bastra-recall/core and the MCP SDK at
 * runtime and spawns dist/index.js (the daemon), which needs the full
 * dependency set. Copying the tree verbatim keeps ESM resolution untouched.
 *
 * Idempotent: same version = reuse the existing copy (marker + forwarder
 * present). Old version dirs are left in place on upgrade — another surface
 * may still be registered against them until its own re-install re-points it.
 */
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { FORWARDER_SCRIPT_PATH } from "./paths.js";
import { VERSION, fileExists } from "./helpers.js";

/**
 * True when the path lives inside an npm exec cache. "_npx" is matched as a
 * path SEGMENT, never a substring — "my_npx_tools" is a permanent install.
 * Both separators: npx caches exist on Windows too.
 */
export function isEphemeralInstallPath(p: string): boolean {
  return p.split(/[\\/]+/).includes("_npx");
}

export interface RuntimeTarget {
  /** ~/.bastra/runtime/<version> */
  rootDir: string;
  /** <rootDir>/node_modules/@bastra-recall/daemon/dist/mcp-forwarder.js */
  forwarderPath: string;
  /** <rootDir>/runtime-source.json — records where the copy came from */
  markerPath: string;
}

export function stableRuntimeTarget(version: string, home: string = homedir()): RuntimeTarget {
  const rootDir = join(home, ".bastra", "runtime", version);
  return {
    rootDir,
    forwarderPath: join(rootDir, "node_modules", "@bastra-recall", "daemon", "dist", "mcp-forwarder.js"),
    markerPath: join(rootDir, "runtime-source.json"),
  };
}

/**
 * The node_modules dir hosting the daemon package
 * (…/node_modules/@bastra-recall/daemon → …/node_modules), or null when the
 * layout is not a node_modules install (source checkout: packages/daemon).
 */
export function resolveNodeModulesRoot(packageRoot: string): string | null {
  const nmDir = dirname(dirname(packageRoot));
  return basename(nmDir) === "node_modules" ? nmDir : null;
}

/**
 * Copies the flat node_modules tree into the versioned runtime dir. Staging
 * dir + rename, so a killed install never leaves a half-copied tree at the
 * final path.
 */
export async function copyRuntimeTree(
  sourceNodeModules: string,
  target: RuntimeTarget,
  version: string,
): Promise<void> {
  const staging = `${target.rootDir}.tmp-${process.pid}`;
  try {
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    await cp(sourceNodeModules, join(staging, "node_modules"), { recursive: true });
    const marker = { version, source: sourceNodeModules, copied_at: new Date().toISOString() };
    await writeFile(join(staging, basename(target.markerPath)), JSON.stringify(marker, null, 2) + "\n", "utf8");
    await rm(target.rootDir, { recursive: true, force: true });
    await rename(staging, target.rootDir);
  } catch (e) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw e;
  }
}

export interface ForwarderResolution {
  /** The forwarder path install should register. */
  path: string;
  action: "native" | "reused" | "copied" | "would-copy" | "fallback";
  /** Human line for the install output (`runtime: …`); absent on "native". */
  note?: string;
}

/**
 * Resolves the forwarder path install should register. Permanent installs
 * (source checkout, Homebrew, global npm) pass through untouched; npx-cache
 * installs get the runtime pinned under ~/.bastra/runtime/<version>/ first.
 * Best-effort: a failed copy falls back to the cache path (today's behavior)
 * with a note — install never throws over this.
 */
export async function ensureStableForwarder(
  opts: { dryRun: boolean },
  io: { forwarderPath?: string; version?: string; home?: string } = {},
): Promise<ForwarderResolution> {
  const fwd = io.forwarderPath ?? FORWARDER_SCRIPT_PATH;
  if (!isEphemeralInstallPath(fwd)) return { path: fwd, action: "native" };

  const version = io.version ?? VERSION;
  const target = stableRuntimeTarget(version, io.home);
  if ((await fileExists(target.markerPath)) && (await fileExists(target.forwarderPath))) {
    return { path: target.forwarderPath, action: "reused", note: `stable runtime ${version} reused (${target.rootDir})` };
  }
  if (opts.dryRun) {
    return { path: target.forwarderPath, action: "would-copy", note: `would copy runtime to ${target.rootDir} (npx cache is ephemeral)` };
  }

  // FORWARDER_SCRIPT_PATH is <packageRoot>/dist/mcp-forwarder.js.
  const nmRoot = resolveNodeModulesRoot(dirname(dirname(fwd)));
  if (!nmRoot) {
    return { path: fwd, action: "fallback", note: "npx cache detected but package layout unexpected — registering the cache path (prefer a permanent install: npm i -g)" };
  }
  try {
    await copyRuntimeTree(nmRoot, target, version);
    return { path: target.forwarderPath, action: "copied", note: `copied to ${target.rootDir} (npx cache is ephemeral — registrations now survive cache eviction)` };
  } catch (e) {
    // Concurrent install may have won the rename race — the copy is there.
    if (await fileExists(target.forwarderPath)) {
      return { path: target.forwarderPath, action: "reused", note: `stable runtime ${version} reused (${target.rootDir})` };
    }
    return { path: fwd, action: "fallback", note: `runtime copy failed (${(e as Error).message}) — registering the npx cache path` };
  }
}

export interface ForwarderPathCheck {
  detail: string;
  broken: boolean;
}

/**
 * Doctor's forwarder-path line (#180). A registration inside the npx cache
 * still works today but breaks silently when npm evicts the cache entry —
 * flag it with the fix-it hint before that happens.
 */
export function checkForwarderRegistration(fwd: string, exists: boolean, surface: string): ForwarderPathCheck {
  if (!exists) {
    return { detail: `${fwd} (MISSING — re-run 'bastra install ${surface}')`, broken: true };
  }
  if (isEphemeralInstallPath(fwd)) {
    return {
      detail: `${fwd} (EPHEMERAL npx cache — breaks when npm evicts it; re-run 'bastra install ${surface}' to pin ~/.bastra/runtime)`,
      broken: true,
    };
  }
  return { detail: `${fwd} (exists)`, broken: false };
}
