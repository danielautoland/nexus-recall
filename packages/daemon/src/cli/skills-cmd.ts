/**
 * `bastra skills` (#215) — declare-once registry of link targets that live on
 * another surface (Claude Code skills, external docs). Declared ids render as
 * first-class nodes in the map's skills ring instead of "unwritten" ghosts,
 * and the curator stops reporting them as dangling links. No path, no scan,
 * no sync — the id is the whole declaration.
 */
import { addSkill, listSkills, removeSkill, skillsFilePath } from "../skills-registry.js";
import type { ParsedArgs } from "./types.js";

const USAGE =
  "usage: bastra skills list\n" +
  "       bastra skills add <id> [label…]     declare a skill (id = the [[slug]] your notes link)\n" +
  "       bastra skills remove <id>           back to ordinary ghost behavior\n";

export async function cmdSkills(args: ParsedArgs): Promise<number> {
  const sub = args.surface;
  if (sub === "list" || sub === null) {
    const entries = await listSkills();
    if (entries.length === 0) {
      process.stdout.write(`no skills declared — ${USAGE}`);
      return 0;
    }
    for (const e of entries) {
      process.stdout.write(`  ${e.id}${e.label ? ` — ${e.label}` : ""}${e.note ? ` (${e.note})` : ""}\n`);
    }
    process.stdout.write(`${entries.length} skill(s) · ${skillsFilePath()}\n`);
    return 0;
  }
  if (sub === "add") {
    const id = args.positional[2];
    if (!id) {
      process.stderr.write(USAGE);
      return 2;
    }
    const label = args.positional.slice(3).join(" ") || undefined;
    try {
      const entry = await addSkill({ id, label });
      process.stdout.write(
        `✓ declared skill ${entry.id}${entry.label ? ` — ${entry.label}` : ""}\n` +
          `  it now renders in the map's skills ring instead of as an unwritten ghost.\n`,
      );
      return 0;
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      return 1;
    }
  }
  if (sub === "remove") {
    const id = args.positional[2];
    if (!id) {
      process.stderr.write(USAGE);
      return 2;
    }
    const removed = await removeSkill(id);
    process.stdout.write(removed ? `✓ removed ${id}\n` : `not declared: ${id}\n`);
    return removed ? 0 : 1;
  }
  process.stderr.write(USAGE);
  return 2;
}
