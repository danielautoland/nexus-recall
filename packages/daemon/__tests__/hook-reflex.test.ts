/**
 * Tests für die Reflex-Lane (#217): hartes recall_when-Matching ohne Query,
 * Reflex-Subset-Filter (recall_mode/private/obsolete), Budget-Cut mit
 * (#Matches, salience)-Sortierung, POST /hook/reflex inkl. Kill-Switch.
 *
 * Runner: `node --import tsx --test packages/daemon/__tests__/hook-reflex.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { Vault, SearchIndex, tokenizeWithIdentifiers } from "@bastra-recall/core";
import { phraseMatchesContext, collectReflexHits } from "../src/reflex.js";
import { startHttpServer } from "../src/http.js";
import { Telemetry } from "../src/telemetry.js";

function memoryMarkdown(
  id: string,
  opts: {
    recall_when: string[];
    recall_when_expanded?: string[];
    recall_mode?: string;
    salience?: number;
    sensitivity?: string;
    obsolete?: boolean;
  },
): string {
  const ts = new Date().toISOString();
  return [
    "---",
    `id: ${id}`,
    `title: Title of ${id}`,
    "type: lesson",
    `summary: Summary of ${id}`,
    "topic_path:",
    "  - test",
    "tags:",
    "  - test",
    "scope: reflex-test",
    "recall_when:",
    ...opts.recall_when.map((p) => `  - ${JSON.stringify(p)}`),
    ...(opts.recall_when_expanded
      ? ["recall_when_expanded:", ...opts.recall_when_expanded.map((p) => `  - ${JSON.stringify(p)}`)]
      : []),
    ...(opts.recall_mode ? [`recall_mode: ${opts.recall_mode}`] : []),
    ...(opts.salience != null ? [`salience: ${opts.salience}`] : []),
    ...(opts.sensitivity ? [`sensitivity: ${opts.sensitivity}`] : []),
    ...(opts.obsolete ? ["obsolete: true"] : []),
    `created: ${ts}`,
    `updated: ${ts}`,
    "---",
    "",
    `Body of ${id}.`,
    "",
  ].join("\n");
}

// gleiche Normalisierung wie collectReflexHits: lowercase + Identifier-Tokens
const ctx = (text: string): Set<string> => new Set(tokenizeWithIdentifiers(text.toLowerCase()));

test("phraseMatchesContext: token-AND, stopwords dropped, no prefix matching", () => {
  const context = ctx("I'm about to write a tailwind grid component");
  assert.equal(
    phraseMatchesContext("about to write a tailwind grid", context),
    true,
    "function words (about/to/a) must not block the match",
  );
  assert.equal(phraseMatchesContext("tailwind flexbox", context), false, "one missing token → no match");
  assert.equal(phraseMatchesContext("tailwind gri", context), false, "no prefix matching");
  assert.equal(phraseMatchesContext("zu ab", context), false, "only short tokens → never matches");
  assert.equal(phraseMatchesContext("beim bitte wenn", context), false, "stopword-only phrase never matches");
});

test("phraseMatchesContext: single free-text token never fires, single identifier token does", () => {
  const context = ctx("deployment via npm-shrinkwrap auf es2022 umstellen");
  // Ein einzelnes Freitext-Wort wäre ein Streutrigger — gesperrt.
  assert.equal(phraseMatchesContext("deployment", context), false);
  // Identifier (Ziffer/Glue) dürfen als Ein-Token-Trigger feuern.
  assert.equal(phraseMatchesContext("es2022", context), true);
  assert.equal(phraseMatchesContext("npm-shrinkwrap", context), true);
});

async function makeVault(): Promise<{ dir: string; vault: Vault }> {
  const dir = await mkdtemp(join(tmpdir(), "bastra-reflex-"));
  const mem = join(dir, "memories");
  await mkdir(mem, { recursive: true });
  await writeFile(
    join(mem, "reflex-css.md"),
    memoryMarkdown("reflex-css", {
      recall_when: ["tailwind grid layout bauen", "css specificity fight"],
      recall_mode: "reflex",
      salience: 0.4,
    }),
  );
  await writeFile(
    join(mem, "reflex-hot.md"),
    memoryMarkdown("reflex-hot", {
      recall_when: ["tailwind grid layout bauen"],
      recall_mode: "reflex",
      salience: 0.9,
    }),
  );
  await writeFile(
    join(mem, "plain.md"),
    memoryMarkdown("plain", {
      recall_when: ["tailwind grid layout bauen"],
    }),
  );
  await writeFile(
    join(mem, "private-reflex.md"),
    memoryMarkdown("private-reflex", {
      recall_when: ["tailwind grid layout bauen"],
      recall_mode: "reflex",
      sensitivity: "private",
    }),
  );
  await writeFile(
    join(mem, "obsolete-reflex.md"),
    memoryMarkdown("obsolete-reflex", {
      recall_when: ["tailwind grid layout bauen"],
      recall_mode: "reflex",
      obsolete: true,
    }),
  );
  const vault = new Vault(dir);
  await vault.init();
  return { dir, vault };
}

test("collectReflexHits: subset filter, hard match, budget with salience ordering", async () => {
  const { dir, vault } = await makeVault();
  try {
    const { pool, matched, served } = collectReflexHits(
      vault,
      "bitte das tailwind grid layout bauen und testen",
      2,
    );
    assert.equal(pool, 2, "only non-private, non-obsolete reflex memories in the pool");
    assert.deepEqual(
      matched.map((m) => m.memory.fm.id).sort(),
      ["reflex-css", "reflex-hot"],
      "plain/private/obsolete never match",
    );
    // gleiche #Matches → höhere salience zuerst
    assert.equal(served[0].memory.fm.id, "reflex-hot");
    assert.equal(served[0].phrase, "tailwind grid layout bauen");

    // Budget-Cut auf 1
    const capped = collectReflexHits(vault, "bitte das tailwind grid layout bauen und testen", 1);
    assert.equal(capped.served.length, 1);
    assert.equal(capped.matched.length, 2, "matched behält alle Treffer fürs Tracing");

    // zwei matchende Phrasen schlagen eine
    const twoPhrases = collectReflexHits(
      vault,
      "css specificity fight beim tailwind grid layout bauen",
      2,
    );
    assert.equal(twoPhrases.served[0].memory.fm.id, "reflex-css");

    // kein Kontext-Match → leer
    assert.equal(collectReflexHits(vault, "völlig anderes thema", 2).matched.length, 0);
  } finally {
    await vault.stop?.();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

function httpPost(port: number, path: string, payload: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body).toString() },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("POST /hook/reflex serves budgeted hits and honors the kill switch", async () => {
  const { dir, vault } = await makeVault();
  const search = new SearchIndex(vault);
  search.start();
  const telemetry = new Telemetry();
  const handle = await startHttpServer({
    port: 0,
    vault,
    search,
    telemetry,
    version: "test",
    toolDeps: { vault, search, telemetry, vaultPath: dir },
    documentWriteEnabled: false,
    embedding: { on: false, providerId: null, source: "none" },
  });
  process.env.BASTRA_REFLEX = "on";
  try {
    const ok = await httpPost(handle.port!, "/hook/reflex", {
      context: "gleich das tailwind grid layout bauen",
      project: "reflex-test",
    });
    assert.equal(ok.status, 200);
    const payload = JSON.parse(ok.body) as {
      hits: { id: string; matched_phrase: string }[];
      recall_id: string | null;
    };
    assert.equal(payload.hits.length, 2, "default budget is 2");
    assert.equal(payload.hits[0].id, "reflex-hot");
    assert.equal(payload.hits[0].matched_phrase, "tailwind grid layout bauen");
    assert.ok(payload.recall_id, "served hits carry a recall_id for the episode join");

    const missing = await httpPost(handle.port!, "/hook/reflex", {});
    assert.equal(missing.status, 400);

    process.env.BASTRA_REFLEX = "off";
    const off = await httpPost(handle.port!, "/hook/reflex", {
      context: "gleich schreibe ich ein tailwind grid",
    });
    assert.equal(off.status, 200);
    assert.deepEqual(JSON.parse(off.body), { hits: [], recall_id: null });
  } finally {
    delete process.env.BASTRA_REFLEX;
    search.stop();
    await vault.stop?.();
    await handle.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("phraseMatchesContext: 'oder'/'or' splits a phrase into alternatives (19.08. incident)", () => {
  // „Nachricht oder Antwort entwerfen" verlangte vorher BEIDE Substantive —
  // die Nachrichtenkonvention feuerte beim Nachricht-Entwerfen nie.
  const context = ctx("dann noch die finale Antwort entwerfen und posten");
  assert.equal(
    phraseMatchesContext("Nachricht oder Antwort entwerfen", context),
    true,
    "one satisfied alternative is enough",
  );
  assert.equal(
    phraseMatchesContext("Nachricht oder Antwort entwerfen", ctx("wir bauen das feature fertig")),
    false,
    "no alternative satisfied → no match",
  );
  // Jede Alternative spielt nach den normalen Regeln: ein einzelnes
  // Freitext-Wort bleibt auch als Alternative ein Streutrigger und feuert nie.
  assert.equal(
    phraseMatchesContext("deployment oder rollout", ctx("das deployment läuft")),
    false,
    "single free-text alternatives stay muted",
  );
});

test("collectReflexHits: recall_when_expanded counts — inflection survives via the generated variants", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-reflex-expanded-"));
  const mem = join(dir, "memories");
  await mkdir(mem, { recursive: true });
  await writeFile(
    join(mem, "konvention.md"),
    memoryMarkdown("konvention", {
      recall_when: ["Nachricht an einen Contributor entwerfen"],
      recall_when_expanded: ["entwurf einer antwort erstellen"],
      recall_mode: "reflex",
      salience: 0.9,
    }),
  );
  const vault = new Vault(dir);
  await vault.init();
  try {
    // Der Prompt trifft keine Original-Phrase (Flexion: „entwirfst" statt
    // „entwerfen"), aber eine expandierte Variante.
    const { matched, served } = collectReflexHits(
      vault,
      "bitte den entwurf der antwort an zzalli erstellen",
      2,
    );
    assert.equal(matched.length, 1, "the expanded variant fires");
    assert.equal(served[0].memory.fm.id, "konvention");
    assert.equal(served[0].phrase, "entwurf einer antwort erstellen");
  } finally {
    await vault.stop?.();
    await rm(dir, { recursive: true, force: true });
  }
});
