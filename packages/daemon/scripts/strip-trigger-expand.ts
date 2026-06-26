/**
 * Rollback tool for doc2query (#117): removes the two fields the TriggerExpander
 * adds — `recall_when_expanded` and `recall_when_expanded_src` — restoring each
 * memory to its pre-doc2query content. Everything else (body, all other
 * frontmatter) is left as gray-matter re-serializes it.
 *
 * Usage:
 *   tsx scripts/strip-trigger-expand.ts <dir> [--apply]
 *   (default is a dry run that only reports; --apply actually writes)
 */
import { readdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".md")) yield p;
  }
}

async function strip(file: string, apply: boolean): Promise<boolean> {
  const raw = await readFile(file, "utf8");
  const parsed = matter(raw);
  const fm = parsed.data as Record<string, unknown>;
  if (!("recall_when_expanded" in fm) && !("recall_when_expanded_src" in fm)) return false;
  const next = { ...fm };
  delete next.recall_when_expanded;
  delete next.recall_when_expanded_src;
  if (!apply) return true;
  const out = matter.stringify(parsed.content.startsWith("\n") ? parsed.content : `\n${parsed.content}`, next);
  const tmp = `${file}.${process.pid}.strip.tmp`;
  await writeFile(tmp, out, "utf8");
  try {
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  return true;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!dir) {
    process.stderr.write("usage: tsx strip-trigger-expand.ts <dir> [--apply]\n");
    process.exit(2);
  }
  let touched = 0;
  for await (const f of walk(dir)) {
    if (await strip(f, apply)) touched++;
  }
  process.stdout.write(`${apply ? "stripped" : "would strip"} ${touched} files of doc2query fields\n`);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
