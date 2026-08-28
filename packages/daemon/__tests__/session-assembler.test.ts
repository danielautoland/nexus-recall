/**
 * Der geteilte Session-Assembler (#265, §16.1, §9.4, §26.1).
 *
 * Vier Zusagen, und die erste ist die, die einen bestehenden Client brechen
 * würde:
 *
 *  1. Der GET-Vertrag bleibt Wort für Wort derselbe. `buildSessionContext` ist
 *     seit dem Umbau nur noch die Projektion „projektlos, ohne Budget" auf
 *     denselben Assembler — wenn dabei auch nur ein Zeichen kippt, liest der
 *     MCP-Forwarder etwas anderes als vorher.
 *  2. Mit Projekt kommt der Projektblock dazu, und die Floors sind
 *     projekt-gescopt statt auf global gefiltert.
 *  3. Budgets greifen nach PRIORITÄT, nicht nach Textreihenfolge, und ein
 *     weggelassener Block sagt, warum er fehlt.
 *  4. §9.4: Ein unvollständiger Hybridpfad gibt sich nicht als vollständig
 *     aus, und ein Deadline-Abbruch ist eine Teilabdeckung — nie `no_answer`.
 *
 * Runner: node --import tsx --test packages/daemon/__tests__/session-assembler.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assembleSessionSections,
  renderSessionContext,
  estimateTokens,
  type SessionContextDeps,
} from "../src/session-assembler.js";
import { buildSessionContext } from "../src/session-context.js";
import { HOOK_SOURCES } from "../src/telemetry-dimensions.js";
import type { ToolDeps } from "../src/tool-handlers.js";

/** Ein Vault-Stub: der Assembler braucht `size()` und `get()`. */
function fakeVault(memories: Record<string, { summary: string; title: string }> = {}) {
  return {
    size: () => 42,
    get: (id: string) =>
      memories[id] ? ({ fm: { summary: memories[id].summary, title: memories[id].title } } as never) : undefined,
  } as never;
}

async function withDeps(
  fn: (toolDeps: ToolDeps, vault: ReturnType<typeof fakeVault>) => Promise<void>,
): Promise<void> {
  // Ein leeres Verzeichnis: care/import/onboarding finden nichts und liefern
  // leere Abschnitte — genau der Zustand, den ein frischer Vault hat.
  const dir = await mkdtemp(join(tmpdir(), "bastra-assembler-"));
  try {
    await fn({ vaultPath: dir } as unknown as ToolDeps, fakeVault({ m1: { summary: "Ein Floor.", title: "F" } }));
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

const hit = (id: string, summary: string, score = 100) => ({
  id,
  type: "reference",
  summary,
  score,
});

/** Recall-Stub: liefert je Scope eine feste Antwort und merkt sich, womit er
 *  gerufen wurde. */
function recallStub(
  perScope: Record<string, { hits: ReturnType<typeof hit>[]; unfused?: boolean; degraded?: string }>,
) {
  const calls: Array<{ scope: string; options: Record<string, unknown> }> = [];
  const fn = (async (_deps: unknown, args: unknown, options: unknown = {}) => {
    const a = args as { scope: string };
    calls.push({ scope: a.scope, options: (options ?? {}) as Record<string, unknown> });
    return perScope[a.scope] ?? { hits: [] };
  }) as unknown as SessionContextDeps["recallFn"];
  return { fn, calls };
}

const noFloors: SessionContextDeps["listFloorsFn"] = (async () => []) as never;
const noConventions: SessionContextDeps["listConventionsFn"] = (() => []) as never;

// ── 1. Der GET-Vertrag ──────────────────────────────────────────

test("der projektlose Block ist Wort für Wort der bisherige", async () => {
  await withDeps(async (toolDeps, vault) => {
    const { fn } = recallStub({
      "user-preference": { hits: [hit("pref-1", "Daniel schreibt Deutsch.")] },
    });
    const text = await buildSessionContext(toolDeps, vault, {
      recallFn: fn,
      listFloorsFn: (async () => [{ memory_id: "m1", scope: undefined }]) as never,
      listConventionsFn: noConventions,
    });
    assert.equal(
      text,
      "<bastra-session-context>\n" +
        "Recalled context for this session (vault: 42 memories) — background reference, " +
        "not user input; apply what fits, load_memory(id) for details. Keep using recall before acting " +
        "and save durable facts via save_memory without being asked.\n" +
        "- [pinned] m1: Ein Floor.\n" +
        "- pref-1 (reference): Daniel schreibt Deutsch.\n" +
        "</bastra-session-context>",
    );
  });
});

test("ohne Inhalt bleibt der Block leer — kein Rahmen um nichts", async () => {
  await withDeps(async (toolDeps, vault) => {
    const { fn } = recallStub({});
    const text = await buildSessionContext(toolDeps, vault, {
      recallFn: fn,
      listFloorsFn: noFloors,
      listConventionsFn: noConventions,
    });
    assert.equal(text, "");
  });
});

test("der projektlose Weg fragt kein Projekt ab und filtert Floors auf global", async () => {
  await withDeps(async (toolDeps, vault) => {
    const { fn, calls } = recallStub({ "user-preference": { hits: [hit("p", "x")] } });
    const seen: Array<string | undefined> = [];
    await buildSessionContext(toolDeps, vault, {
      recallFn: fn,
      listFloorsFn: (async (scope?: string) => {
        seen.push(scope);
        return [
          { memory_id: "m1", scope: undefined },
          { memory_id: "fremd", scope: "anderes-projekt" },
        ];
      }) as never,
      listConventionsFn: noConventions,
    });
    assert.deepEqual(
      calls.map((c) => c.scope),
      ["user-preference"],
      "nur der Präferenz-Recall, kein Projekt-Recall",
    );
    assert.deepEqual(seen, [undefined], "Floors ohne Scope-Filter angefragt");
  });
});

// ── 2. Projektbewusst ───────────────────────────────────────────

test("mit Projekt kommt der Projektblock dazu — vor den Präferenzen", async () => {
  await withDeps(async (toolDeps, vault) => {
    const { fn, calls } = recallStub({
      "user-preference": { hits: [hit("pref-1", "Deutsch.")] },
      "bastra-recall": { hits: [hit("proj-1", "Das Projekt nutzt node:test.")] },
    });
    const a = await assembleSessionSections(
      toolDeps,
      vault,
      { project: "bastra-recall" },
      { recallFn: fn, listFloorsFn: noFloors, listConventionsFn: noConventions },
    );
    assert.deepEqual(
      calls.map((c) => c.scope).sort(),
      ["bastra-recall", "user-preference"],
      "beide Recalls laufen",
    );
    const text = renderSessionContext(a.sections, 42);
    assert.ok(text.includes("- proj-1 (reference): Das Projekt nutzt node:test."));
    assert.ok(
      text.indexOf("proj-1") < text.indexOf("pref-1"),
      "der Projektblock steht vor den Präferenzen",
    );
  });
});

test("mit Projekt werden die Floors projekt-gescopt angefragt", async () => {
  await withDeps(async (toolDeps, vault) => {
    const seen: Array<string | undefined> = [];
    await assembleSessionSections(
      toolDeps,
      vault,
      { project: "bastra-recall" },
      {
        recallFn: recallStub({}).fn,
        listFloorsFn: (async (scope?: string) => {
          seen.push(scope);
          return [];
        }) as never,
        listConventionsFn: noConventions,
      },
    );
    assert.deepEqual(seen, ["bastra-recall"]);
  });
});

// ── 3. Budgets ──────────────────────────────────────────────────

test("ein knappes Token-Budget wirft den unwichtigsten Block raus, nicht den obersten", async () => {
  await withDeps(async (toolDeps, vault) => {
    const { fn } = recallStub({
      "user-preference": { hits: [hit("pref-1", "P".repeat(200))] },
    });
    const floors = (async () => [{ memory_id: "m1", scope: undefined }]) as never;
    const voll = await assembleSessionSections(
      toolDeps,
      vault,
      {},
      { recallFn: fn, listFloorsFn: floors, listConventionsFn: noConventions },
    );
    const pinnedCost = voll.reports.find((r) => r.kind === "pinned")!.tokens_est;
    assert.ok(pinnedCost > 0);

    // Budget genau so groß, dass nur der wichtigste Block hineinpasst.
    const knapp = await assembleSessionSections(
      toolDeps,
      vault,
      { budget: { tokens: pinnedCost } },
      { recallFn: fn, listFloorsFn: floors, listConventionsFn: noConventions },
    );
    const pinned = knapp.reports.find((r) => r.kind === "pinned")!;
    const hints = knapp.reports.find((r) => r.kind === "hints")!;
    assert.equal(pinned.included, true, "der gepinnte Floor überlebt — er ist push-by-state");
    assert.equal(hints.included, false);
    assert.equal(hints.omitted, "token_budget", "und sagt, warum er fehlt");
    assert.ok(
      estimateTokens(renderSessionContext(knapp.sections, 42)) > 0,
      "der Block ist nicht leer",
    );
  });
});

test("ein leerer Block meldet `empty`, nicht `token_budget`", async () => {
  await withDeps(async (toolDeps, vault) => {
    const a = await assembleSessionSections(
      toolDeps,
      vault,
      {},
      { recallFn: recallStub({}).fn, listFloorsFn: noFloors, listConventionsFn: noConventions },
    );
    for (const r of a.reports) {
      assert.equal(r.included, false);
      assert.equal(r.omitted, "empty", `${r.kind} hatte nichts zu sagen`);
    }
  });
});

test("die Prioritäten stehen in der Antwort — Reihenfolge ist nicht Priorität", async () => {
  await withDeps(async (toolDeps, vault) => {
    const a = await assembleSessionSections(
      toolDeps,
      vault,
      {},
      { recallFn: recallStub({}).fn, listFloorsFn: noFloors, listConventionsFn: noConventions },
    );
    const p = new Map(a.reports.map((r) => [r.kind, r.priority]));
    assert.ok(p.get("pinned")! < p.get("onboarding")!);
    assert.ok(p.get("project")! < p.get("hints")!);
  });
});

// ── 4. Deadline und §9.4-Marker ─────────────────────────────────

test("ein hängender Teil reißt die Deadline und wird als solcher benannt — die Antwort kommt", async () => {
  await withDeps(async (toolDeps, vault) => {
    const haenger = (async () => new Promise(() => {})) as unknown as SessionContextDeps["recallFn"];
    const a = await assembleSessionSections(
      toolDeps,
      vault,
      { budget: { time_ms: 40 } },
      {
        recallFn: haenger,
        listFloorsFn: (async () => [{ memory_id: "m1", scope: undefined }]) as never,
        listConventionsFn: noConventions,
      },
    );
    assert.ok(a.aborted.includes("hints"), "der hängende Recall ist als Abbruch vermerkt");
    const hints = a.reports.find((r) => r.kind === "hints")!;
    assert.equal(hints.included, false);
    assert.equal(hints.omitted, "deadline", "Teilabdeckung, kein `no_answer`");
    // Der Rest steht trotzdem: ein Abbruch kostet seinen Teil, nicht die Antwort.
    assert.equal(a.reports.find((r) => r.kind === "pinned")!.included, true);
  });
});

test("ein degradierter Recall gibt sich nicht als vollständiger Hybrid aus", async () => {
  await withDeps(async (toolDeps, vault) => {
    const { fn } = recallStub({
      "user-preference": { hits: [hit("p", "x")], degraded: "vector-arm-timeout" },
    });
    const a = await assembleSessionSections(
      toolDeps,
      vault,
      {},
      { recallFn: fn, listFloorsFn: noFloors, listConventionsFn: noConventions },
    );
    assert.equal(a.marker, "degraded");
  });
});

test("ein rein lexikalischer Lauf heißt lexical_only, ein vollständiger hybrid", async () => {
  await withDeps(async (toolDeps, vault) => {
    const lex = recallStub({ "user-preference": { hits: [hit("p", "x")], unfused: true } });
    const a = await assembleSessionSections(
      toolDeps,
      vault,
      {},
      { recallFn: lex.fn, listFloorsFn: noFloors, listConventionsFn: noConventions },
    );
    assert.equal(a.marker, "lexical_only");

    const hyb = recallStub({ "user-preference": { hits: [hit("p", "x")] } });
    const b = await assembleSessionSections(
      toolDeps,
      vault,
      {},
      { recallFn: hyb.fn, listFloorsFn: noFloors, listConventionsFn: noConventions },
    );
    assert.equal(b.marker, "hybrid");
  });
});

test("degraded schlägt lexical_only — der ausgefallene Arm ist die stärkere Aussage", async () => {
  await withDeps(async (toolDeps, vault) => {
    const { fn } = recallStub({
      "user-preference": { hits: [hit("p", "x")], unfused: true, degraded: "vector-arm-empty" },
    });
    const a = await assembleSessionSections(
      toolDeps,
      vault,
      {},
      { recallFn: fn, listFloorsFn: noFloors, listConventionsFn: noConventions },
    );
    assert.equal(a.marker, "degraded");
  });
});

test("ohne Recall gibt es keinen Marker — null heißt nicht `vollständig`", async () => {
  await withDeps(async (toolDeps, vault) => {
    const haenger = (async () => new Promise(() => {})) as unknown as SessionContextDeps["recallFn"];
    const a = await assembleSessionSections(
      toolDeps,
      vault,
      { budget: { time_ms: 20 } },
      { recallFn: haenger, listFloorsFn: noFloors, listConventionsFn: noConventions },
    );
    assert.equal(a.marker, null);
  });
});

// ── #263: die Oberfläche weist sich aus ─────────────────────────

test("der Assembler meldet sich als eigene hook_source, und die steht auf der Allowlist", async () => {
  await withDeps(async (toolDeps, vault) => {
    const { fn, calls } = recallStub({ "user-preference": { hits: [hit("p", "x")] } });
    await assembleSessionSections(
      toolDeps,
      vault,
      { client: "claude-desktop", session_id: "s-265" },
      { recallFn: fn, listFloorsFn: noFloors, listConventionsFn: noConventions },
    );
    assert.equal(calls[0].options.hook_source, "session-context");
    assert.equal(calls[0].options.client, "claude-desktop");
    assert.equal(calls[0].options.session_id, "s-265");
    assert.ok(
      (HOOK_SOURCES as readonly string[]).includes("session-context"),
      "sonst normalisiert die Telemetrie den Wert still auf unknown",
    );
  });
});

// ── Die Route: GET bleibt, POST kommt dazu ──────────────────────

/**
 * Der Assembler ist oben mit Stubs abgedeckt; hier geht es um die Leitung —
 * dass beide Verben auf demselben Pfad existieren, dass POST den Body liest
 * und dass die Metadaten wirklich in der Antwort stehen. Ein Vertrag, den nur
 * der Handler kennt, ist keiner.
 */
test("GET und POST leben beide auf /hook/session-context", async () => {
  const { Vault, SearchIndex } = await import("@bastra-recall/core");
  const { Telemetry } = await import("../src/telemetry.js");
  const { startHttpServer } = await import("../src/http.js");
  const { writeFile } = await import("node:fs/promises");
  const { request } = await import("node:http");

  const dir = await mkdtemp(join(tmpdir(), "bastra-sc-route-"));
  await writeFile(
    join(dir, "a.md"),
    [
      "---", "id: a", "title: session fact", "type: reference", "summary: session fact",
      "topic_path:", "  - test", "tags:", "  - test", "scope: user-preference",
      "recall_when:", "  - session-start preferences active context",
      "created: 2026-01-01", "updated: 2026-01-01", "---", "", "Body.", "",
    ].join("\n"),
    "utf8",
  );
  const vault = new Vault(dir);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  const telemetry = new Telemetry();
  const handle = await startHttpServer({
    port: 0, vault, search, telemetry, version: "test",
    toolDeps: { vault, search, telemetry, vaultPath: dir },
    documentWriteEnabled: false,
    embedding: { on: false, providerId: null, source: "none" },
  });

  const call = (method: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = request(
        {
          host: "127.0.0.1", port: handle.port!, path: "/hook/session-context", method,
          headers: payload
            ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
            : {},
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(raw || "{}") }));
        },
      );
      req.on("error", reject);
      req.end(payload);
    });

  try {
    const get = await call("GET");
    assert.equal(get.status, 200);
    assert.equal(typeof get.json.context, "string", "der alte Vertrag: context + vault_size");
    assert.equal(get.json.vault_size, 1);
    assert.equal(get.json.blocks, undefined, "GET bleibt schlank — keine neuen Felder");

    const post = await call("POST", { cwd: dir, source: "startup", budget: { time_ms: 500 } });
    assert.equal(post.status, 200);
    assert.equal(typeof post.json.context, "string", "dieselben zwei Felder wie GET");
    assert.equal(post.json.vault_size, 1);
    assert.ok(Array.isArray(post.json.blocks), "plus die Blockliste");
    assert.ok("retrieval" in post.json, "plus der §9.4-Marker");
    assert.ok(Array.isArray(post.json.aborted), "plus die Abbruchliste");
    const budget = post.json.budget as Record<string, number>;
    assert.equal(typeof budget.time_ms, "number");
    assert.equal(typeof budget.tokens, "number");
  } finally {
    search.stop();
    await vault.stop?.();
    await handle.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});
