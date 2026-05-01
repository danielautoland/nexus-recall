#!/usr/bin/env bash
# install nexus-recall skill into ~/.claude/skills/nexus-recall/
# rerun after every change to SKILL.md to refresh the local copy.

set -euo pipefail

src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dst="${HOME}/.claude/skills/nexus-recall"

mkdir -p "${dst}"
cp "${src}/SKILL.md" "${dst}/SKILL.md"

echo "✓ nexus-recall skill installed at ${dst}/SKILL.md"
echo "  Restart Claude Code so the skill loader picks up the new file."
