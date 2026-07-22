import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The convention layers live in packages/skill/ but must ship inside the
// daemon package (that is what npm publishes). Keep this list in sync with
// the "files" array in package.json — a template that is not copied here is
// simply absent at runtime, and the CLI can only report it as missing.
const assets = [
  ["SKILL.md", "SKILL.md"], // Claude Code / Claude Desktop
  ["cursor-rules.mdc", "cursor-rules.mdc"], // Cursor project rules (#7)
];

for (const [from, to] of assets) {
  const src = resolve(packageRoot, "..", "skill", from);
  const dst = resolve(packageRoot, "skill", to);
  await mkdir(dirname(dst), { recursive: true });
  await copyFile(src, dst);
}
