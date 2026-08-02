/** The daemon's version — read from package.json at runtime, never hardcoded.
 *
 *  Why this file exists: the version used to sit as a string literal in three
 *  places (index.ts twice, mcp-forwarder.ts once), while `scripts/bump.mjs`
 *  only rewrites package.json files. So every release silently left the
 *  literals behind — the repo shipped 0.8.9 while the running daemon reported
 *  0.8.8 in /health, in the MCP handshake, and to the update check.
 *
 *  That last one is the part that actually hurt: startBackgroundCheck compares
 *  the reported version against the published one, so a daemon that understates
 *  its own version asks the wrong question, and "update available" answers stop
 *  making sense.
 *
 *  Reading package.json at runtime makes the mismatch structurally impossible:
 *  bumping the package IS bumping the daemon. Same resolution trick as
 *  resolveWebUiDir() — dist/version.js → ../package.json.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function readVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const version = JSON.parse(readFileSync(pkgPath, "utf8")).version;
    if (typeof version === "string" && version.length > 0) return version;
  } catch {
    // fall through — a daemon that cannot read its own package.json still runs
  }
  return "0.0.0-unknown";
}

export const DAEMON_VERSION = readVersion();
