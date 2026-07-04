/**
 * Tests for src/learned-recall/bridges.ts — bridge model, pool, expansion, scrub, mint.
 *
 * Run: npx tsx --test packages/daemon/__tests__/learned-recall-bridges.test.ts
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BridgePool,
  bridgeId,
  distinctiveTerms,
  expandQuery,
  mintBridge,
  scrubBridge,
  type Bridge,
} from "../src/learned-recall/bridges.js";

async function withPool<T>(
  bridges: Bridge[],
  fn: (pool: BridgePool, root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "bastra-bridges-"));
  try {
    for (const b of bridges) {
      const dir = join(root, "bridges", b.lang);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${b.id}.json`), JSON.stringify(b), "utf8");
    }
    return await fn(BridgePool.load(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function bridge(partial: Partial<Bridge> & Pick<Bridge, "lang" | "trigger_terms" | "expansion_terms">): Bridge {
  return {
    id: partial.id ?? bridgeId(partial.lang, partial.trigger_terms, partial.expansion_terms),
    evidence: partial.evidence ?? 1,
    ...partial,
  };
}

test("distinctiveTerms drops short + generic words, dedupes", () => {
  const terms = distinctiveTerms("the panel panel resignKey with observer");
  assert.ok(terms.includes("panel"));
  assert.ok(terms.includes("resignkey"));
  assert.ok(terms.includes("observer"));
  assert.ok(!terms.includes("the"), "short word dropped");
  assert.ok(!terms.includes("with"), "generic word dropped");
  assert.equal(terms.filter((t) => t === "panel").length, 1, "deduped");
});

test("bridgeId is deterministic and order-independent", () => {
  const a = bridgeId("de", ["panel", "sheet"], ["closes", "modal"]);
  const b = bridgeId("de", ["sheet", "panel"], ["modal", "closes"]);
  assert.equal(a, b, "term order must not change the id");
  assert.notEqual(a, bridgeId("en", ["panel", "sheet"], ["closes", "modal"]), "language is part of the id");
});

test("mintBridge builds trigger from query, expansion from non-overlapping memory terms", () => {
  const b = mintBridge("wie schließt sich das Panel beim Sheet", ["panel", "sheet", "resignkey", "observer"], "de");
  assert.ok(b);
  assert.equal(b!.lang, "de");
  assert.ok(b!.trigger_terms.includes("panel"));
  // "resignkey"/"observer" are in the memory but not the query → expansion
  assert.ok(b!.expansion_terms.includes("resignkey"));
  assert.ok(b!.expansion_terms.includes("observer"));
  // "panel" appears in the query (trigger) so it must NOT also be an expansion
  assert.ok(!b!.expansion_terms.includes("panel"));
  assert.equal(b!.evidence, 1);
});

test("mintBridge returns null when language cannot be detected", () => {
  assert.equal(mintBridge("NSPanel resignKey", ["foo", "bar"], null), null);
});

test("mintBridge returns null when there is no non-overlapping expansion", () => {
  assert.equal(mintBridge("panel sheet observer", ["panel", "sheet"], "en"), null);
});

test("scrubBridge strips identifier-shaped and path-shaped terms", () => {
  const dirty = bridge({
    lang: "en",
    trigger_terms: ["panel", "config_secret"],
    expansion_terms: ["observer", "/Users/me/x", "a1b2c3d4e5", "v2", "modal"],
  });
  const clean = scrubBridge(dirty);
  assert.ok(clean);
  assert.deepEqual(clean!.trigger_terms, ["panel"], "snake_case identifier removed");
  assert.ok(clean!.expansion_terms.includes("observer"));
  assert.ok(clean!.expansion_terms.includes("modal"));
  assert.ok(!clean!.expansion_terms.includes("/Users/me/x"), "path removed");
  assert.ok(!clean!.expansion_terms.includes("a1b2c3d4e5"), "hex hash removed");
  assert.ok(!clean!.expansion_terms.includes("v2"), "digit-bearing term removed");
});

test("scrubBridge returns null when too little survives", () => {
  const dirty = bridge({
    lang: "en",
    trigger_terms: ["config_x"],
    expansion_terms: ["/a/b", "h4sh0000"],
  });
  assert.equal(scrubBridge(dirty), null);
});

test("BridgePool.load partitions by language and only matching-language bridges fire", async () => {
  const deB = bridge({ lang: "de", trigger_terms: ["panel", "sheet"], expansion_terms: ["resignkey", "observer"] });
  const enB = bridge({ lang: "en", trigger_terms: ["panel", "sheet"], expansion_terms: ["dismiss", "modal"] });
  await withPool([deB, enB], async (pool) => {
    assert.equal(pool.size(), 2);
    assert.equal(pool.size("de"), 1);
    assert.equal(pool.size("en"), 1);
    // German query → only the German bridge's expansion
    const de = pool.expansionsFor("wie schließt das Panel", "de");
    assert.ok(de.includes("resignkey"));
    assert.ok(!de.includes("dismiss"), "English expansion must not leak into a German query");
  });
});

test("BridgePool ignores corrupt and unknown-language files", async () => {
  const root = await mkdtemp(join(tmpdir(), "bastra-bridges-"));
  try {
    await mkdir(join(root, "bridges", "de"), { recursive: true });
    await mkdir(join(root, "bridges", "fr"), { recursive: true });
    await writeFile(join(root, "bridges", "de", "ok.json"), JSON.stringify(bridge({ lang: "de", trigger_terms: ["panel"], expansion_terms: ["sheet", "modal"] })), "utf8");
    await writeFile(join(root, "bridges", "de", "corrupt.json"), "{ not json", "utf8");
    await writeFile(join(root, "bridges", "fr", "x.json"), JSON.stringify({ lang: "fr", trigger_terms: ["x"], expansion_terms: ["y"], id: "z", evidence: 1 }), "utf8");
    const pool = BridgePool.load(root);
    assert.equal(pool.size("de"), 1, "corrupt file skipped, valid kept");
    assert.deepEqual(pool.languages(), ["de"], "unknown language dir ignored");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BridgePool.load caps oversized terms from a foreign repo and drops fully-oversized bridges", async () => {
  const longTerm = "x".repeat(40); // > MAX_SHARE_TERM_LEN (24)
  const partlyDirty = bridge({ lang: "de", trigger_terms: ["panel", longTerm], expansion_terms: ["resignkey", longTerm] });
  const allDirty = bridge({ lang: "de", trigger_terms: [longTerm], expansion_terms: [longTerm + "y"] });
  await withPool([partlyDirty, allDirty], async (pool) => {
    assert.equal(pool.size("de"), 1, "bridge with only oversized terms is dropped");
    const added = pool.expansionsFor("warum schließt das Panel", "de");
    assert.ok(added.includes("resignkey"));
    assert.ok(!added.some((t) => t.length > 24), "no oversized term reaches the query");
  });
});

test("expandQuery appends matching expansion terms and routes on detected language", async () => {
  const deB = bridge({ lang: "de", trigger_terms: ["panel"], expansion_terms: ["resignkey", "observer"] });
  await withPool([deB], async (pool) => {
    const r = expandQuery("warum schließt sich das Panel wieder", pool);
    assert.equal(r.lang, "de");
    assert.ok(r.added.includes("resignkey"));
    assert.ok(r.query.includes("resignkey"), "expansion appended to query");
    assert.ok(r.query.startsWith("warum schließt"), "original query preserved");
  });
});

test("expandQuery is a no-op for a null pool or abstained language", async () => {
  assert.deepEqual(expandQuery("anything", null), { query: "anything", lang: null, added: [] });
  const deB = bridge({ lang: "de", trigger_terms: ["panel"], expansion_terms: ["resignkey"] });
  await withPool([deB], async (pool) => {
    // code-shaped query → language abstains → no expansion even though a bridge exists
    const r = expandQuery("NSPanel resignKey Observer", pool);
    assert.equal(r.lang, null);
    assert.equal(r.added.length, 0);
    assert.equal(r.query, "NSPanel resignKey Observer");
  });
});

test("expandQuery caps the base at a word boundary BEFORE appending expansions (#162)", async () => {
  const deB = bridge({ lang: "de", trigger_terms: ["panel"], expansion_terms: ["resignkey", "observer"] });
  await withPool([deB], async (pool) => {
    // Trigger up front, then enough filler to blow past the 4000-char base cap.
    const query = "panel " + "füllwort ".repeat(500); // ~4500 chars
    const r = expandQuery(query, pool, { configuredLang: "de" });
    assert.deepEqual(r.added, ["resignkey", "observer"], "expansion fired");
    // Structural guarantee: the appended terms sit INSIDE the capped string,
    // so core's downstream QUERY_MAX_CHARS defense can never cut them —
    // telemetry never claims an expansion that was dropped.
    assert.ok(r.query.endsWith(" resignkey observer"), "expansions survive at the tail");
    const base = r.query.slice(0, -" resignkey observer".length);
    assert.ok(base.length <= 4000, `base capped to 4000 (got ${base.length})`);
    assert.ok(
      base.trim().split(/\s+/).every((w) => w === "panel" || w === "füllwort"),
      "base cap falls on a word boundary — no half token",
    );
  });
});

test("expandQuery trigger matching sees the FULL query, not the capped base", async () => {
  const deB = bridge({ lang: "de", trigger_terms: ["resignkey"], expansion_terms: ["observer", "modal"] });
  await withPool([deB], async (pool) => {
    // The only trigger term sits beyond the 4000-char base cap.
    const query = "füllwort ".repeat(500) + "resignkey";
    const r = expandQuery(query, pool, { configuredLang: "de" });
    assert.deepEqual(r.added, ["observer", "modal"], "trigger beyond the cap still fires");
    assert.ok(r.query.endsWith(" observer modal"));
  });
});

test("expandQuery leaves a short base untouched when appending", async () => {
  const deB = bridge({ lang: "de", trigger_terms: ["panel"], expansion_terms: ["resignkey"] });
  await withPool([deB], async (pool) => {
    const r = expandQuery("warum schließt das Panel", pool, { configuredLang: "de" });
    assert.equal(r.query, "warum schließt das Panel resignkey", "no cap side effects below 4000 chars");
  });
});

test("configuredLang override forces a pool regardless of detection", async () => {
  const deB = bridge({ lang: "de", trigger_terms: ["panel"], expansion_terms: ["resignkey"] });
  await withPool([deB], async (pool) => {
    // ambiguous/code query, but user configured 'de' → German pool is consulted
    const r = expandQuery("panel observer", pool, { configuredLang: "de" });
    assert.equal(r.lang, "de");
    assert.ok(r.added.includes("resignkey"));
  });
});
