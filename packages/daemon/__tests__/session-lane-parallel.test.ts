/**
 * Die SessionStart-Lane läuft nebenläufig statt der Reihe nach (#265, §16.1).
 *
 * #369 hat die Pipeline aus dem Hook-Prozess in den Daemon gezogen — das
 * sparte den Node-Start, ließ die Aufrufe aber sequenziell: bis zu drei Recalls
 * hintereinander, danach sechs Seitenabrufe mit je eigenem Budget (5×150 ms +
 * 200 ms). Die addieren sich in genau dem Budget, das §16.1 begrenzt, und sind
 * die Fläche, die #354 als Latenz misst.
 *
 * Dieser Test misst nicht „ist es schneller" (das hinge an der Maschine),
 * sondern die überprüfbare Eigenschaft dahinter: Wieviele Anfragen sind
 * GLEICHZEITIG unterwegs? Sequenziell ist das nie mehr als eine. Der Stub-
 * Server hält jede Anfrage kurz fest und schreibt den Höchststand mit.
 *
 * Runner: node --import tsx --test packages/daemon/__tests__/session-lane-parallel.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { runSessionLane } from "../src/session-lane.js";

/** Wie lange jede Antwort künstlich braucht. Groß genug, dass sich eine
 *  serialisierte Kette messbar von einer nebenläufigen unterscheidet, klein
 *  genug, dass der Test in Millisekunden fertig ist. */
const DELAY_MS = 40;

interface Probe {
  port: number;
  /** Höchststand gleichzeitig offener Anfragen. */
  peak: number;
  /** Pfad → Anzahl Aufrufe. */
  calls: Map<string, number>;
  close: () => Promise<void>;
}

const RECALL_BODY = JSON.stringify({
  hits: [
    {
      id: "m1",
      title: "Session fact",
      type: "reference",
      scope: "user-preference",
      summary: "Ein Fakt.",
      score: 150,
      mode: "hybrid",
      rrf: { rank_bm25: 1, rank_vector: 1, personal_score: 0.03, raw: 0.03 },
    },
  ],
  vault_size: 1,
  latency_ms: 1,
  recall_id: "r1",
  score_kind: "rrf",
});

const BODIES: Record<string, string> = {
  "/hook/recall": RECALL_BODY,
  "/hook/floors": JSON.stringify({ entries: [] }),
  "/hook/taxonomy": JSON.stringify({ conventions: [] }),
  "/hook/care": JSON.stringify({ open: 0, queued: 0 }),
  "/hook/import": JSON.stringify({ open: 0, queued: 0 }),
  "/hook/onboarding": JSON.stringify({ needed: false }),
  "/health": JSON.stringify({ ok: true }),
};

async function withProbe(fn: (p: Probe) => Promise<void>): Promise<void> {
  let inFlight = 0;
  let peak = 0;
  const calls = new Map<string, number>();

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    calls.set(path, (calls.get(path) ?? 0) + 1);
    inFlight++;
    peak = Math.max(peak, inFlight);
    // Body verwerfen, sonst hängt der Client an einem ungelesenen Stream.
    req.resume();
    setTimeout(() => {
      inFlight--;
      const body = BODIES[path];
      res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
      res.end(body ?? "{}");
    }, DELAY_MS);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await fn({
      port,
      get peak() {
        return peak;
      },
      calls,
      close: () => new Promise<void>((r) => server.close(() => r())),
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test("die Lane hat mehrere Anfragen gleichzeitig offen — sequenziell wäre der Höchststand 1", async () => {
  await withProbe(async (p) => {
    const out = await runSessionLane(
      { hook_event_name: "SessionStart", source: "startup", cwd: "/tmp", session_id: "s-265" },
      `http://127.0.0.1:${p.port}`,
    );
    // Die Lane hält ihren fail-open-Vertrag: immer ein JSON-Dokument.
    assert.doesNotThrow(() => JSON.parse(out));
    assert.ok(
      p.peak > 1,
      `es war nie mehr als eine Anfrage gleichzeitig offen (peak ${p.peak}) — die Kette läuft noch seriell`,
    );
  });
});

test("beide Phasen laufen nebenläufig: erst die Recalls, dann die Seitenabrufe", async () => {
  await withProbe(async (p) => {
    await runSessionLane(
      { hook_event_name: "SessionStart", source: "startup", cwd: "/tmp", session_id: "s-265" },
      `http://127.0.0.1:${p.port}`,
    );
    // Ohne erkanntes Projekt stellt die Lane zwei Recalls; die sechs
    // Seitenabrufe kommen unabhängig davon. Der Höchststand muss die größere
    // der beiden Gruppen erreichen — sonst lief mindestens eine Phase seriell.
    assert.ok(
      p.peak >= 6,
      `Höchststand ${p.peak}: die sechs Seitenabrufe liefen nicht gemeinsam`,
    );
  });
});

test("jeder Seitenabruf wird genau einmal gemacht — Parallelität verdoppelt nichts", async () => {
  await withProbe(async (p) => {
    await runSessionLane(
      { hook_event_name: "SessionStart", source: "startup", cwd: "/tmp", session_id: "s-265" },
      `http://127.0.0.1:${p.port}`,
    );
    for (const path of ["/hook/floors", "/hook/taxonomy", "/hook/care", "/hook/import", "/hook/onboarding"]) {
      assert.equal(p.calls.get(path) ?? 0, 1, `${path} wurde nicht genau einmal aufgerufen`);
    }
  });
});

test("ein unerreichbarer Daemon bleibt fail-open — kein Wurf, ein JSON-Dokument", async () => {
  // Port, auf dem niemand hört: jeder Aufruf scheitert sofort mit ECONNREFUSED.
  // Nebenläufig heißt hier, dass alle drei Recalls es versuchen statt nach dem
  // ersten abzubrechen — das darf am Ergebnis nichts ändern.
  const out = await runSessionLane(
    { hook_event_name: "SessionStart", source: "startup", cwd: "/tmp" },
    "http://127.0.0.1:1",
  );
  assert.doesNotThrow(() => JSON.parse(out));
});
