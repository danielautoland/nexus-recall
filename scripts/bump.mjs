#!/usr/bin/env node
/**
 * bump.mjs — set a new version across all workspace packages AND keep the
 * internal cross-dependency pins in lockstep.
 *
 * Why: `npm version --workspaces` bumps each package's own version but does
 * NOT rewrite the internal pins (e.g. the daemon's `"@bastra-recall/core":
 * "0.7.0-beta.1"`), so a publish would resolve a stale dependency version.
 * This rewrites the version of every workspace + root and every dependency
 * entry that points at an internal package, in one shot.
 *
 *   node scripts/bump.mjs <version> [--dry-run]
 *
 * Example:
 *   node scripts/bump.mjs 0.7.0-beta.2 --dry-run   # preview only
 *   node scripts/bump.mjs 0.7.0-beta.2             # apply
 *
 * Does NOT touch git — commit, tag and `gh release create` stay manual.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const version = args.find((a) => !a.startsWith("--"));

if (!version) {
  console.error("usage: node scripts/bump.mjs <version> [--dry-run]");
  process.exit(1);
}
// Coarse semver check: major.minor.patch (+ optional -prerelease / +build).
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`error: '${version}' is not a valid semver version`);
  process.exit(1);
}

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

// 1) Collect package.json paths: root + every workspace.
const rootPkgPath = resolve(repoRoot, "package.json");
const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf8"));
const pkgPaths = [
  rootPkgPath,
  ...(rootPkg.workspaces ?? []).map((w) => resolve(repoRoot, w, "package.json")),
];

// 2) Load them all, then learn the internal package names from their `name`.
const pkgs = pkgPaths.map((path) => ({
  path,
  json: JSON.parse(readFileSync(path, "utf8")),
}));
const internalNames = new Set(pkgs.map((p) => p.json.name).filter(Boolean));

// 3) Set version + rewrite internal pins; record every change.
const changes = [];
for (const { path, json } of pkgs) {
  const rel = path.startsWith(repoRoot + "/")
    ? path.slice(repoRoot.length + 1)
    : path;
  let dirty = false;

  if (json.version !== version) {
    changes.push(`${rel}: version ${json.version} → ${version}`);
    json.version = version;
    dirty = true;
  }

  for (const field of DEP_FIELDS) {
    const deps = json[field];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (internalNames.has(name) && deps[name] !== version) {
        changes.push(`${rel}: ${field}.${name} ${deps[name]} → ${version}`);
        deps[name] = version;
        dirty = true;
      }
    }
  }

  if (!dryRun && dirty) {
    writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  }
}

// 3b) Version-string constants in source files. bump.mjs originally only
// touched package.json files, so these shipped stale (beta.2/beta.3 packages
// reported "0.7.0-beta.1" in /health and the MCP handshake). Every pattern
// MUST match — a miss fails the bump loudly instead of silently re-opening
// the gap when a constant moves or gets renamed.
const VERSION_SOURCES = [
  { path: "packages/daemon/src/cli/helpers.ts", re: /(export const VERSION = ")[^"]+(")/ },
  { path: "packages/daemon/src/index.ts", re: /(const DAEMON_VERSION = ")[^"]+(")/ },
  { path: "packages/daemon/src/index.ts", re: /(\{ name: "bastra-recall", version: ")[^"]+(" \})/ },
  { path: "packages/daemon/src/mcp-forwarder.ts", re: /(\{ name: "bastra-recall-mcp", version: ")[^"]+(" \})/ },
];
for (const { path: relPath, re } of VERSION_SOURCES) {
  const abs = resolve(repoRoot, relPath);
  const src = readFileSync(abs, "utf8");
  const m = src.match(re);
  if (!m) {
    console.error(`error: version pattern not found in ${relPath} — update VERSION_SOURCES in scripts/bump.mjs`);
    process.exit(1);
  }
  const current = m[0].slice(m[1].length, m[0].length - m[2].length);
  if (current === version) continue;
  changes.push(`${relPath}: "${current}" → "${version}"`);
  if (!dryRun) writeFileSync(abs, src.replace(re, `$1${version}$2`));
}

// 4) Report.
if (changes.length === 0) {
  console.log(`Nothing to change — everything is already at ${version}.`);
} else {
  console.log(`${dryRun ? "[dry-run] would apply" : "applied"} ${changes.length} change(s):`);
  for (const c of changes) console.log("  " + c);
  if (!dryRun) {
    console.log(
      `\nNext:\n  npm install            # refresh package-lock\n  git commit -am "release: v${version}"\n  gh release create v${version} --prerelease --generate-notes`,
    );
  }
}
