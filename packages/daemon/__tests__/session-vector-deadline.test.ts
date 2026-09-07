/**
 * Die 300-ms-Deadline der SessionStart-Lane und ihr Degradationsfeld
 * (Daniel, 07.09.2026, nach dem Deep-Dive vom selben Tag).
 *
 * Der Deep-Dive hat gemessen: 46 % der Session-Recalls (55 von 119) kamen
 * einarmig zurück, weil der Hook-Pfad dem dichten Arm 150 ms gibt und der
 * erste Embed auf kaltem Modell ~160-180 ms braucht. Diese Lane bekommt
 * deshalb 300 ms — und ZWAR NUR SIE. Drei Zusagen hängen daran, und jede
 * einzelne wäre still zu brechen:
 *
 *  1. Die Lane schickt `vector_deadline_ms: 300` in ihrem Aufruf.
 *  2. Der Weg dahinter reicht die Zahl bis an den dichten Arm durch — und ohne
 *     sie bleibt es beim hookweiten Default. Ein Aufrufer, der nichts sagt
 *     (Prompt-Lane, Bash-Pfad, hookloser GET-Weg), darf sich nicht mitziehen.
 *  3. Ein einarmiger SessionStart steht nicht mehr als schlichtes `ok` in der
 *     Telemetrie: `degraded_reason` nennt den ausgefallenen Arm,
 *     `score_unfused` sagt, auf welcher Skala die Zahlen liegen.
 *
 * Runner: node --import tsx --test packages/daemon/__tests__/session-vector-deadline.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSessionLane } from "../src/session-lane.js";
import { handleSessionContextPost } from "../src/session-context.js";
import type { ToolDeps } from "../src/tool-handlers.js";

async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const before = new Map(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [k, v] of before) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function readEvents(logDir: string): Promise<Record<string, unknown>[]> {
  const files = (await readdir(logDir)).filter((n) => n.startsWith("events-") && n.endsWith(".jsonl"));
  const out: Record<string, unknown>[] = [];
  for (const f of files) {
    for (const l of (await readFile(join(logDir, f), "utf8")).split("\n")) {
      if (l.trim()) out.push(JSON.parse(l) as Record<string, unknown>);
    }
  }
  return out;
}

// ── 1./2. Die Zahl auf dem Weg zum dichten Arm ──────────────────

/**
 * Der echte POST-Handler auf einem echten Server, aber mit einem Suchindex,
 * der nur mitschreibt, womit er gerufen wurde. Die Zusage ist genau das: die
 * Deadline erreicht `recallHybrid`. Ein Test, der nur den Request-Body prüft,
 * bewiese nur, dass die Lane etwas sagt — nicht, dass es ankommt.
 */
async function deadlinesSeenBy(body: Record<string, unknown>, vaultPath: string): Promise<number[]> {
  const seen: number[] = [];
  const search = {
    hasEmbeddings: () => true,
    recallHybrid: async (_q: string, opts: { vector_deadline_ms?: number }) => {
      seen.push(opts.vector_deadline_ms as number);
      return [];
    },
    recall: () => [],
  };
  const telemetry = {
    rotateTurn: () => {},
    newRecallId: () => "r-1",
    recordHookHints: () => {},
    matchLoadedMemories: () => [],
    logRecallEpisode: async () => {},
    logHookRecall: async () => {},
    logEvidenceDecision: async () => {},
  };
  const vault = { size: () => 0, get: () => undefined, root: vaultPath };
  const toolDeps = { vaultPath, search, telemetry } as unknown as ToolDeps;

  const server: Server = createServer((req, res) => {
    void handleSessionContextPost(req, res, toolDeps, vault as never);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    await new Promise<void>((resolve, reject) => {
      const req = request(
        {
          method: "POST",
          hostname: "127.0.0.1",
          port,
          path: "/hook/session-context",
          headers: { "content-type": "application/json", "content-length": payload.byteLength },
        },
        (res) => {
          res.on("data", () => {});
          res.on("end", () => resolve());
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  return seen;
}

test("die Session-Route reicht vector_deadline_ms bis an den dichten Arm durch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-session-deadline-"));
  try {
    const seen = await withEnv({ BASTRA_VECTOR_DEADLINE_MS: "150" }, () =>
      deadlinesSeenBy({ project: null, vector_deadline_ms: 300 }, dir),
    );
    assert.ok(seen.length > 0, "die Route hat überhaupt einen Recall gefahren");
    assert.deepEqual(
      [...new Set(seen)],
      [300],
      "jeder Recall dieses Aufrufs bekommt die 300 ms — nicht nur der erste",
    );
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("ohne vector_deadline_ms bleibt es beim hookweiten Default — die anderen Lanes ziehen nicht mit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-session-deadline-default-"));
  try {
    const seen = await withEnv({ BASTRA_VECTOR_DEADLINE_MS: "150" }, () =>
      deadlinesSeenBy({ project: null }, dir),
    );
    assert.ok(seen.length > 0, "die Route hat überhaupt einen Recall gefahren");
    assert.deepEqual([...new Set(seen)], [150], "der Default gilt weiter, wenn niemand etwas sagt");
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

// ── Die Lane: was sie schickt und was sie protokolliert ─────────

/** Ein Daemon-Doppel, das den POST-Body festhält und eine wählbare Antwort
 *  liefert — genug für die Lane, die daraus ihren Block baut. */
async function withDaemon(
  resp: Record<string, unknown> | null,
  fn: (baseUrl: string, bodies: Record<string, unknown>[]) => Promise<void>,
): Promise<void> {
  const seenBodies: Record<string, unknown>[] = [];
  const sessionContext = JSON.stringify({
    budget: {},
    aborted: [],
    data: {
      recalls: resp === null ? [] : [{ scope: "user-preference", resp }],
      floors: [],
      conventions: [],
      care: { open: 0, queued: 0 },
      imports: { open: 0, queued: 0 },
      onboarding: false,
    },
  });
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (path === "/hook/session-context" && chunks.length > 0) {
        try {
          seenBodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
        } catch {
          /* ein unlesbarer Body ist der Testfehler unten, nicht hier */
        }
      }
      const body =
        path === "/hook/session-context"
          ? sessionContext
          : path === "/health"
            ? JSON.stringify({ ok: true })
            : "{}";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    await fn(`http://127.0.0.1:${port}`, seenBodies);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const fusedHit = {
  hits: [
    {
      id: "m1",
      title: "Session fact",
      type: "reference",
      scope: "user-preference",
      summary: "Ein Fakt.",
      score: 150,
    },
  ],
  vault_size: 1,
  latency_ms: 1,
  recall_id: "r1",
  score_kind: "rrf",
};

test("die SessionStart-Lane fordert 300 ms für den dichten Arm an", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "bastra-session-lane-deadline-"));
  try {
    await withDaemon(fusedHit, async (base, bodies) => {
      await withEnv({ BASTRA_TELEMETRY: "off", BASTRA_LOG_PATH: logDir }, () =>
        runSessionLane(
          { hook_event_name: "SessionStart", source: "startup", cwd: "/tmp", session_id: "sess-deadline" },
          base,
        ),
      );
      assert.equal(bodies.length, 1, "genau ein Assembler-Aufruf (#265)");
      assert.equal(bodies[0].vector_deadline_ms, 300);
    });
  } finally {
    await rm(logDir, { recursive: true, force: true });
  }
});

test("ein einarmiger SessionStart meldet den ausgefallenen Arm statt nur ok", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "bastra-session-degraded-"));
  try {
    await withDaemon(
      {
        ...fusedHit,
        // Genau die Form, die `/hook/recall` bei gerissener Deadline sendet:
        // roher BM25-Score, `unfused`, und der Grund als `degraded`.
        hits: [{ ...fusedHit.hits[0], score: 405585 }],
        score_kind: "bm25",
        unfused: true,
        degraded: "vector-arm-timeout",
      },
      async (base) => {
        await withEnv({ BASTRA_TELEMETRY: "on", BASTRA_LOG_PATH: logDir }, () =>
          runSessionLane(
            { hook_event_name: "SessionStart", source: "startup", cwd: "/tmp", session_id: "sess-degraded" },
            base,
          ),
        );
      },
    );
    const ev = (await readEvents(logDir)).find((e) => e.kind === "session_hook_call");
    assert.ok(ev, "eine session_hook_call-Zeile muss geschrieben werden");
    assert.equal(ev.degraded_reason, "vector-arm-timeout");
    assert.equal(ev.score_unfused, true);
    assert.equal(ev.status, "ok", "der Transport war in Ordnung — das sagt `status` und nur das");
  } finally {
    await rm(logDir, { recursive: true, force: true });
  }
});

test("ein zweiarmiger SessionStart meldet keinen Grund — das Feld beschreibt den Ausfall, nicht die Norm", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "bastra-session-fused-"));
  try {
    await withDaemon(fusedHit, async (base) => {
      await withEnv({ BASTRA_TELEMETRY: "on", BASTRA_LOG_PATH: logDir }, () =>
        runSessionLane(
          { hook_event_name: "SessionStart", source: "startup", cwd: "/tmp", session_id: "sess-fused" },
          base,
        ),
      );
    });
    const ev = (await readEvents(logDir)).find((e) => e.kind === "session_hook_call");
    assert.ok(ev, "eine session_hook_call-Zeile muss geschrieben werden");
    assert.equal(ev.degraded_reason, null);
    assert.equal(ev.score_unfused, false);
  } finally {
    await rm(logDir, { recursive: true, force: true });
  }
});
