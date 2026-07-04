/**
 * Tests for the stable runtime of npx-based installs (#180): the pure
 * ephemeral-path decision, the node_modules-root resolution, the
 * copy-into-~/.bastra/runtime round-trip (fixture dirs, no real npm), and
 * doctor's forwarder-path check formatting.
 *
 * ensureStableForwarder is exercised with injected forwarderPath/version/home
 * so no test touches the real HOME or a real npx cache.
 *
 * Run: npx tsx --test packages/daemon/__tests__/stable-runtime.test.ts
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkForwarderRegistration,
  ensureStableForwarder,
  isEphemeralInstallPath,
  resolveNodeModulesRoot,
  stableRuntimeTarget,
} from "../src/cli/stable-runtime.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "bastra-stable-runtime-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

/**
 * Builds a fake npx cache: a flat node_modules with the daemon package and
 * two "production deps" — the shape `npx @bastra-recall/daemon` materializes.
 * Returns the node_modules root and the forwarder path inside it.
 */
async function makeFakeNpxCache(dir: string): Promise<{ nmRoot: string; forwarderPath: string }> {
  const nmRoot = join(dir, ".npm", "_npx", "0123abcd4567ef89", "node_modules");
  const daemonPkg = join(nmRoot, "@bastra-recall", "daemon");
  await mkdir(join(daemonPkg, "dist"), { recursive: true });
  await writeFile(join(daemonPkg, "package.json"), '{"name":"@bastra-recall/daemon","type":"module"}\n', "utf8");
  await writeFile(join(daemonPkg, "dist", "mcp-forwarder.js"), "// fake forwarder\n", "utf8");
  await writeFile(join(daemonPkg, "dist", "index.js"), "// fake daemon\n", "utf8");
  const corePkg = join(nmRoot, "@bastra-recall", "core");
  await mkdir(join(corePkg, "dist"), { recursive: true });
  await writeFile(join(corePkg, "package.json"), '{"name":"@bastra-recall/core","type":"module"}\n', "utf8");
  await writeFile(join(corePkg, "dist", "index.js"), "// fake core\n", "utf8");
  await mkdir(join(nmRoot, "zod"), { recursive: true });
  await writeFile(join(nmRoot, "zod", "package.json"), '{"name":"zod"}\n', "utf8");
  return { nmRoot, forwarderPath: join(daemonPkg, "dist", "mcp-forwarder.js") };
}

// ─── isEphemeralInstallPath (pure matrix) ────────────────────────────────────

test("isEphemeralInstallPath: npx cache paths are ephemeral", () => {
  assert.equal(isEphemeralInstallPath("/Users/x/.npm/_npx/0123abcd/node_modules/@bastra-recall/daemon/dist/mcp-forwarder.js"), true);
  assert.equal(isEphemeralInstallPath("/home/x/.npm/_npx/ff00/node_modules/@bastra-recall/daemon/dist/mcp-forwarder.js"), true);
  // Windows separators — npx caches exist there too.
  assert.equal(isEphemeralInstallPath("C:\\Users\\x\\AppData\\Local\\npm-cache\\_npx\\ab12\\node_modules\\@bastra-recall\\daemon\\dist\\mcp-forwarder.js"), true);
  // segment at the very start
  assert.equal(isEphemeralInstallPath("_npx/abc/dist/mcp-forwarder.js"), true);
});

test("isEphemeralInstallPath: permanent installs are not", () => {
  // global npm
  assert.equal(isEphemeralInstallPath("/usr/local/lib/node_modules/@bastra-recall/daemon/dist/mcp-forwarder.js"), false);
  // Homebrew
  assert.equal(isEphemeralInstallPath("/opt/homebrew/lib/node_modules/@bastra-recall/daemon/dist/mcp-forwarder.js"), false);
  // source checkout
  assert.equal(isEphemeralInstallPath("/Users/x/Projekte/bastra-recall/packages/daemon/dist/mcp-forwarder.js"), false);
  assert.equal(isEphemeralInstallPath(""), false);
});

test("isEphemeralInstallPath: '_npx' must be a path segment, never a substring", () => {
  assert.equal(isEphemeralInstallPath("/home/x/my_npx_tools/daemon/dist/mcp-forwarder.js"), false);
  assert.equal(isEphemeralInstallPath("/home/x/_npx_backup/dist/mcp-forwarder.js"), false);
});

// ─── resolveNodeModulesRoot ──────────────────────────────────────────────────

test("resolveNodeModulesRoot: scoped package under node_modules → the node_modules dir", () => {
  assert.equal(
    resolveNodeModulesRoot("/x/.npm/_npx/ab/node_modules/@bastra-recall/daemon"),
    "/x/.npm/_npx/ab/node_modules",
  );
});

test("resolveNodeModulesRoot: source checkout is not a node_modules install", () => {
  assert.equal(resolveNodeModulesRoot("/repo/packages/daemon"), null);
});

// ─── stableRuntimeTarget layout ──────────────────────────────────────────────

test("stableRuntimeTarget: versioned dir under <home>/.bastra/runtime", () => {
  const t = stableRuntimeTarget("1.2.3", "/tmp/home-x");
  assert.equal(t.rootDir, join("/tmp/home-x", ".bastra", "runtime", "1.2.3"));
  assert.equal(t.forwarderPath, join(t.rootDir, "node_modules", "@bastra-recall", "daemon", "dist", "mcp-forwarder.js"));
  assert.equal(t.markerPath, join(t.rootDir, "runtime-source.json"));
});

// ─── ensureStableForwarder (fixture dirs, no real npm) ───────────────────────

test("ensureStableForwarder: permanent install passes through untouched", async () => {
  await withTempDir(async (dir) => {
    const home = join(dir, "home");
    const fwd = "/opt/homebrew/lib/node_modules/@bastra-recall/daemon/dist/mcp-forwarder.js";
    const r = await ensureStableForwarder({ dryRun: false }, { forwarderPath: fwd, version: "9.9.9", home });
    assert.equal(r.action, "native");
    assert.equal(r.path, fwd);
    assert.equal(r.note, undefined);
    assert.equal(await exists(join(home, ".bastra")), false);
  });
});

test("ensureStableForwarder: npx cache → copies the tree and returns the stable path", async () => {
  await withTempDir(async (dir) => {
    const home = join(dir, "home");
    const { nmRoot, forwarderPath } = await makeFakeNpxCache(dir);
    const r = await ensureStableForwarder({ dryRun: false }, { forwarderPath, version: "9.9.9-test", home });

    assert.equal(r.action, "copied");
    const target = stableRuntimeTarget("9.9.9-test", home);
    assert.equal(r.path, target.forwarderPath);
    assert.ok(r.note?.includes(target.rootDir), `note names the runtime dir: ${r.note}`);

    // Full tree survives: forwarder + daemon package.json + production deps.
    assert.equal(await readFile(target.forwarderPath, "utf8"), "// fake forwarder\n");
    assert.ok(await exists(join(target.rootDir, "node_modules", "@bastra-recall", "daemon", "package.json")));
    assert.ok(await exists(join(target.rootDir, "node_modules", "@bastra-recall", "core", "dist", "index.js")));
    assert.ok(await exists(join(target.rootDir, "node_modules", "zod", "package.json")));

    // Marker records the source.
    const marker = JSON.parse(await readFile(target.markerPath, "utf8"));
    assert.equal(marker.version, "9.9.9-test");
    assert.equal(marker.source, nmRoot);
    assert.ok(typeof marker.copied_at === "string" && marker.copied_at.length > 0);
  });
});

test("ensureStableForwarder: same version reuses the copy — survives cache eviction", async () => {
  await withTempDir(async (dir) => {
    const home = join(dir, "home");
    const { forwarderPath } = await makeFakeNpxCache(dir);
    const first = await ensureStableForwarder({ dryRun: false }, { forwarderPath, version: "9.9.9-test", home });
    assert.equal(first.action, "copied");

    // A sentinel in the runtime dir proves the second run does not re-copy.
    const target = stableRuntimeTarget("9.9.9-test", home);
    await writeFile(join(target.rootDir, "sentinel.txt"), "untouched\n", "utf8");

    // Evict the npx cache — the whole point of #180.
    await rm(join(dir, ".npm"), { recursive: true, force: true });

    const second = await ensureStableForwarder({ dryRun: false }, { forwarderPath, version: "9.9.9-test", home });
    assert.equal(second.action, "reused");
    assert.equal(second.path, target.forwarderPath);
    assert.equal(await readFile(join(target.rootDir, "sentinel.txt"), "utf8"), "untouched\n");
  });
});

test("ensureStableForwarder: new version copies again alongside the old one", async () => {
  await withTempDir(async (dir) => {
    const home = join(dir, "home");
    const { forwarderPath } = await makeFakeNpxCache(dir);
    await ensureStableForwarder({ dryRun: false }, { forwarderPath, version: "1.0.0", home });
    const r = await ensureStableForwarder({ dryRun: false }, { forwarderPath, version: "2.0.0", home });
    assert.equal(r.action, "copied");
    assert.ok(await exists(stableRuntimeTarget("1.0.0", home).forwarderPath));
    assert.ok(await exists(stableRuntimeTarget("2.0.0", home).forwarderPath));
  });
});

test("ensureStableForwarder: dry-run reports the target path, writes nothing", async () => {
  await withTempDir(async (dir) => {
    const home = join(dir, "home");
    const { forwarderPath } = await makeFakeNpxCache(dir);
    const r = await ensureStableForwarder({ dryRun: true }, { forwarderPath, version: "9.9.9-test", home });
    assert.equal(r.action, "would-copy");
    assert.equal(r.path, stableRuntimeTarget("9.9.9-test", home).forwarderPath);
    assert.match(r.note ?? "", /would copy/);
    assert.equal(await exists(join(home, ".bastra")), false);
  });
});

test("ensureStableForwarder: unexpected layout falls back to the cache path, never throws", async () => {
  await withTempDir(async (dir) => {
    const home = join(dir, "home");
    // _npx in the path but the package does NOT live under node_modules.
    const fwd = join(dir, "_npx", "weird", "daemon", "dist", "mcp-forwarder.js");
    const r = await ensureStableForwarder({ dryRun: false }, { forwarderPath: fwd, version: "9.9.9", home });
    assert.equal(r.action, "fallback");
    assert.equal(r.path, fwd);
    assert.match(r.note ?? "", /layout unexpected/);
  });
});

test("ensureStableForwarder: failed copy falls back to the cache path, never throws", async () => {
  await withTempDir(async (dir) => {
    const home = join(dir, "home");
    // Plausible npx layout as a string, but nothing exists on disk → cp fails.
    const fwd = join(dir, "_npx", "ab", "node_modules", "@bastra-recall", "daemon", "dist", "mcp-forwarder.js");
    const r = await ensureStableForwarder({ dryRun: false }, { forwarderPath: fwd, version: "9.9.9", home });
    assert.equal(r.action, "fallback");
    assert.equal(r.path, fwd);
    assert.match(r.note ?? "", /copy failed/);
  });
});

// ─── doctor forwarder-path check (pure formatting) ───────────────────────────

test("checkForwarderRegistration: healthy permanent path", () => {
  const c = checkForwarderRegistration("/opt/homebrew/lib/node_modules/@bastra-recall/daemon/dist/mcp-forwarder.js", true, "claude-code");
  assert.equal(c.broken, false);
  assert.match(c.detail, /\(exists\)$/);
});

test("checkForwarderRegistration: missing path → broken with re-install hint", () => {
  const c = checkForwarderRegistration("/gone/dist/mcp-forwarder.js", false, "cursor");
  assert.equal(c.broken, true);
  assert.match(c.detail, /MISSING/);
  assert.match(c.detail, /re-run 'bastra install cursor'/);
});

test("checkForwarderRegistration: existing npx-cache path → broken with re-install hint (#180)", () => {
  const c = checkForwarderRegistration("/Users/x/.npm/_npx/ab12/node_modules/@bastra-recall/daemon/dist/mcp-forwarder.js", true, "claude-desktop");
  assert.equal(c.broken, true);
  assert.match(c.detail, /EPHEMERAL npx cache/);
  assert.match(c.detail, /re-run 'bastra install claude-desktop'/);
  assert.match(c.detail, /\.bastra\/runtime/);
});

test("checkForwarderRegistration: missing beats ephemeral in the wording", () => {
  const c = checkForwarderRegistration("/Users/x/.npm/_npx/ab12/node_modules/@bastra-recall/daemon/dist/mcp-forwarder.js", false, "claude-code");
  assert.equal(c.broken, true);
  assert.match(c.detail, /MISSING/);
});
