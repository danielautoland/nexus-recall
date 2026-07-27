#!/usr/bin/env bash
# install bastra-recall skill into ~/.claude/skills/bastra-recall/
# rerun after every change to the skill files to refresh the local copy.
#
# Migration: removes any pre-existing ~/.claude/skills/nexus-recall/ so the
# old skill doesn't shadow the new one in the Claude Code skill loader.

set -euo pipefail

src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dst="${HOME}/.claude/skills/bastra-recall"
legacy="${HOME}/.claude/skills/nexus-recall"

if [ -d "${legacy}" ]; then
  echo "→ removing legacy skill at ${legacy}"
  rm -rf "${legacy}"
fi

mkdir -p "${dst}"
# The skill is a directory, not a file (#232): SKILL.md plus the reference
# files it points at. The install scripts and cursor-rules.mdc next to them are
# not part of the skill and stay out of ~/.claude/skills/.
cp "${src}"/*.md "${dst}/"

echo "✓ bastra-recall skill installed at ${dst}/"
echo "  Restart Claude Code so the skill loader picks up the new file."
