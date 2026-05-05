#!/usr/bin/env bash
# Install / update the nexus-recall PreToolUse hook in ~/.claude/settings.json.
#
# Idempotent: re-running updates the path if it changed; will not duplicate
# the matcher block. Backs up settings.json before each write.
#
# Usage:
#   bash packages/skill/install-hook.sh                # install
#   bash packages/skill/install-hook.sh --uninstall    # remove
#   bash packages/skill/install-hook.sh --print        # dry-run, print resulting JSON

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOK_BIN="${REPO_ROOT}/packages/daemon/dist/hook.js"
SETTINGS_FILE="${HOME}/.claude/settings.json"
ACTION="install"
for arg in "$@"; do
  case "$arg" in
    --uninstall) ACTION="uninstall" ;;
    --print) ACTION="print" ;;
    *) echo "unknown flag: $arg" >&2 ; exit 2 ;;
  esac
done

if [[ "$ACTION" == "install" || "$ACTION" == "print" ]]; then
  if [[ ! -f "${HOOK_BIN}" ]]; then
    echo "✗ hook binary not built: ${HOOK_BIN}" >&2
    echo "  Run: (cd ${REPO_ROOT} && npm install && npm run build)" >&2
    exit 1
  fi
  chmod +x "${HOOK_BIN}" 2>/dev/null || true
fi

mkdir -p "$(dirname "${SETTINGS_FILE}")"
[[ -f "${SETTINGS_FILE}" ]] || echo "{}" > "${SETTINGS_FILE}"

if [[ "$ACTION" != "print" ]]; then
  cp "${SETTINGS_FILE}" "${SETTINGS_FILE}.bak"
fi

# Patch JSON via inline Node — robust against existing hook entries.
HOOK_BIN="${HOOK_BIN}" SETTINGS_FILE="${SETTINGS_FILE}" ACTION="${ACTION}" \
  node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
import { stdout } from "node:process";

const file = process.env.SETTINGS_FILE;
const hookBin = process.env.HOOK_BIN;
const action = process.env.ACTION;
const MARKER = "nexus-recall PreToolUse hook";

const raw = readFileSync(file, "utf8") || "{}";
let cfg;
try { cfg = JSON.parse(raw); }
catch { console.error(`✗ ${file} is not valid JSON. Aborting.`); process.exit(1); }
if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) cfg = {};

cfg.hooks ??= {};
const matchers = (cfg.hooks.PreToolUse ??= []);

// Drop any prior nexus-recall PreToolUse entry (matcher or marker hit).
const next = [];
for (const m of matchers) {
  if (!m || typeof m !== "object") { next.push(m); continue; }
  const hooks = Array.isArray(m.hooks) ? m.hooks : [];
  const isOurs = hooks.some((h) =>
    h && typeof h === "object" &&
    (h.__nexusRecall === true || (typeof h.command === "string" && h.command.includes("nexus-recall") && h.command.includes("hook"))),
  );
  if (!isOurs) next.push(m);
}
cfg.hooks.PreToolUse = next;

if (action !== "uninstall") {
  cfg.hooks.PreToolUse.push({
    matcher: "Write|Edit|MultiEdit|NotebookEdit",
    hooks: [
      {
        type: "command",
        command: `node ${JSON.stringify(hookBin).slice(1, -1)}`,
        timeout: 2,
        __nexusRecall: true,
        __note: MARKER,
      },
    ],
  });
}

const out = JSON.stringify(cfg, null, 2) + "\n";
if (action === "print") {
  stdout.write(out);
} else {
  writeFileSync(file, out, "utf8");
}
'

case "$ACTION" in
  install)
    echo "✓ nexus-recall PreToolUse hook registered in ${SETTINGS_FILE}"
    echo "  Command: node ${HOOK_BIN}"
    echo "  Backup:  ${SETTINGS_FILE}.bak"
    echo
    echo "Restart Claude Code (or open a fresh session) to activate."
    ;;
  uninstall)
    echo "✓ nexus-recall PreToolUse hook removed from ${SETTINGS_FILE}"
    echo "  Backup: ${SETTINGS_FILE}.bak"
    ;;
  print)
    : # JSON already written to stdout
    ;;
esac
