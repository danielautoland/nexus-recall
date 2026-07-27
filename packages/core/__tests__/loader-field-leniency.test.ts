/**
 * #222 — a broken FIELD must not cost the whole node. Reported by zzallirog:
 * 28 editor-written notes dropped at daemon load, and the only trace was a
 * `console.warn` a launchd-started daemon never shows anyone.
 *
 * The causes split into two layers, and the issue text only names the second:
 *
 *   A. YAML never parses at all — unknown escape sequences inside double-quoted
 *      values (`"it\'s"`), and unquoted scalars containing `:` or `·`. These
 *      throw out of gray-matter, so `parseMemoryWith` never sees a `data`
 *      object. 24 of the 28 reported files are this class.
 *   B. YAML parses but the frontmatter is incomplete — missing required keys.
 *      4 of the 28.
 *
 * Structural strictness stays: no frontmatter, or no recognizable `type:`, is
 * still NotAMemoryFile. Everything below that is a flagged degradation.
 *
 * Runner: `tsx --test __tests__/loader-field-leniency.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import matter from "gray-matter";
import { parseMemoryWith, NotAMemoryFile } from "../src/schema.js";

const parse = (raw: string, path = "/vault/memories/note.md", mtime = Date.UTC(2026, 4, 17)) =>
  parseMemoryWith((input) => matter(input), raw, path, mtime);

test("A: an unknown escape sequence costs its own field, not the node", () => {
  const m = parse(
    `---\nid: note\ntitle: "it\\'s here"\ntype: lesson\nsummary: Intakte Zusammenfassung\ntopic_path: [a]\ntags: [t]\nscope: s\nrecall_when: ["wenn x"]\ncreated: 2026-05-01\nupdated: 2026-05-01\n---\nDer Body bleibt.`,
  );
  assert.equal(m.fm.id, "note");
  assert.equal(m.fm.summary, "Intakte Zusammenfassung", "the healthy fields must survive intact");
  assert.deepEqual(m.fm.recall_when, ["wenn x"]);
  assert.match(m.body, /Der Body bleibt/);
  assert.ok(m.damaged?.some((d) => d.field === "title"), `title should be flagged, got ${JSON.stringify(m.damaged)}`);
  assert.ok(m.fm.title.length > 0, "a damaged title still needs some value");
});

test("A: an unquoted value containing a colon or a middot costs its own field only", () => {
  const m = parse(
    `---\nid: note\ntitle: Titel bleibt\ntype: lesson\nsummary: Foo · Bar: baz\ntopic_path: [a]\ntags: [t]\nscope: s\nrecall_when: ["wenn x"]\ncreated: 2026-05-01\nupdated: 2026-05-01\n---\nbody`,
  );
  assert.equal(m.fm.title, "Titel bleibt");
  assert.equal(m.fm.scope, "s");
  assert.ok(m.damaged?.some((d) => d.field === "summary"));
});

test("A: multi-line blocks survive the rescue — a list is not torn apart by a broken neighbour", () => {
  const m = parse(
    `---\nid: note\ntitle: "bad\\'escape"\ntype: lesson\nsummary: ok\ntopic_path:\n  - alpha\n  - beta\ntags:\n  - eins\n  - zwei\nscope: s\nrecall_when:\n  - erster trigger\n  - zweiter trigger\ncreated: 2026-05-01\nupdated: 2026-05-01\n---\nbody`,
  );
  assert.deepEqual(m.fm.topic_path, ["alpha", "beta"], "the list after the broken field must stay whole");
  assert.deepEqual(m.fm.tags, ["eins", "zwei"]);
  assert.deepEqual(m.fm.recall_when, ["erster trigger", "zweiter trigger"]);
  assert.ok(m.damaged?.some((d) => d.field === "title"));
});

test("B: missing required keys are filled from what is knowable, and flagged", () => {
  const m = parse(`---\nid: note\ntype: lesson\n---\nErste Zeile des Bodys.\n\nZweiter Absatz.`);
  assert.equal(m.fm.id, "note");
  assert.equal(m.fm.type, "lesson");
  assert.ok(m.fm.title.length > 0);
  assert.ok(m.fm.summary.length > 0);
  assert.ok(m.fm.topic_path.length > 0);
  assert.ok(m.fm.tags.length > 0);
  assert.ok(m.fm.scope.length > 0);
  assert.ok(m.fm.recall_when.length > 0);
  assert.ok(m.fm.created, "created must be derivable from the file mtime");
  const fields = new Set(m.damaged?.map((d) => d.field));
  for (const f of ["title", "summary", "topic_path", "tags", "scope", "recall_when"]) {
    assert.ok(fields.has(f), `${f} should be flagged as degraded, got ${[...fields].join(",")}`);
  }
});

test("B: a missing id falls back to the filename, so the node keeps a stable identity", () => {
  const m = parse(
    `---\ntitle: Ohne id\ntype: lesson\nsummary: s\ntopic_path: [a]\ntags: [t]\nscope: s\nrecall_when: [x]\ncreated: 2026-05-01\nupdated: 2026-05-01\n---\nbody`,
    "/vault/memories/Mein Merk-Satz.md",
  );
  assert.equal(m.fm.id, "mein-merk-satz");
  assert.ok(m.damaged?.some((d) => d.field === "id"));
});

test("a healthy file is untouched — no damaged marker, no behaviour change", () => {
  const m = parse(
    `---\nid: clean\ntitle: Sauber\ntype: lesson\nsummary: Alles gut\ntopic_path: [a, b]\ntags: [t]\nscope: proj\nrecall_when: ["wenn y"]\ncreated: 2026-05-01\nupdated: 2026-05-02\n---\nbody text`,
  );
  assert.equal(m.damaged, undefined, "a healthy memory must carry no damage marker at all");
  assert.equal(m.fm.title, "Sauber");
  assert.deepEqual(m.fm.topic_path, ["a", "b"]);
  assert.equal(m.fm.created, "2026-05-01");
  assert.equal(m.fm.updated, "2026-05-02");
});

test("structural strictness stays: no frontmatter and no recognizable type are still NotAMemoryFile", () => {
  assert.throws(() => parse("Just a plain Obsidian note.\n"), NotAMemoryFile);
  assert.throws(() => parse(`---\nid: x\ntitle: T\n---\nbody`), NotAMemoryFile, "no type: → not a memory");
  assert.throws(() => parse(`---\nid: x\ntype: notatype\n---\nbody`), NotAMemoryFile);
});

test("structural strictness stays through the rescue path too — a type that only survives as garbage is not a memory", () => {
  // The whole frontmatter is unparseable AND carries no usable `type:`.
  assert.throws(() => parse(`---\ntitle: "a\\'b"\nfoo: [unclosed\n---\nbody`), NotAMemoryFile);
});

test("a type that is only readable after the rescue still identifies the memory", () => {
  const m = parse(
    `---\ntitle: "kaputt\\'hier"\ntype: decision\nid: rescued\nsummary: s\ntopic_path: [a]\ntags: [t]\nscope: s\nrecall_when: [x]\ncreated: 2026-05-01\nupdated: 2026-05-01\n---\nbody`,
  );
  assert.equal(m.fm.type, "decision");
  assert.equal(m.fm.id, "rescued");
});

test("an id that is present but path-unsafe is repaired rather than dropped", () => {
  const m = parse(
    `---\nid: ../../etc/passwd\ntitle: T\ntype: lesson\nsummary: s\ntopic_path: [a]\ntags: [t]\nscope: s\nrecall_when: [x]\ncreated: 2026-05-01\nupdated: 2026-05-01\n---\nbody`,
    "/vault/memories/safe-name.md",
  );
  assert.equal(m.fm.id, "safe-name", "a path-unsafe id must not reach the filesystem layer");
  assert.ok(m.damaged?.some((d) => d.field === "id"));
});

test("damaged entries name the field and carry a reason a human can act on", () => {
  const m = parse(
    `---\nid: note\ntitle: "x\\'y"\ntype: lesson\nsummary: ok\ntopic_path: [a]\ntags: [t]\nscope: s\nrecall_when: [x]\ncreated: 2026-05-01\nupdated: 2026-05-01\n---\nbody`,
  );
  const entry = m.damaged?.find((d) => d.field === "title");
  assert.ok(entry);
  assert.ok(entry!.reason.length > 0, "a bare flag without a reason is not actionable");
});
