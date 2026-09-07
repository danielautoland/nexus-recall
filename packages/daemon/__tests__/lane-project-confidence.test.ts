/**
 * §20.5 an den Lanes, die den geratenen Projektnamen bis hierher als Tatsache
 * behandelt haben.
 *
 * Befund: Eine Agenten-Session läuft mit cwd `~/.buzz`. Dort liegt kein `.git`
 * und kein Container-Segment (`Projekte/`, `src/`, …), also fiel
 * `detectProject()` auf das letzte Pfadsegment zurück und lieferte ".buzz" —
 * ununterscheidbar von einer echten Erkennung. Die SessionStart-Lane fragte
 * daraufhin Kandidaten für ein Projekt ".buzz" ab und schrieb `project=".buzz"`
 * in den ausgelieferten Kontextblock; die Prompt-Lane schickte denselben Namen
 * als `project` an `/hook/recall`. Die Write-Lane hatte diese Regel über
 * `projectForFilter()` schon (`write-lane-project-confidence.test.ts`), die
 * anderen nie.
 *
 * Jetzt entscheidet `projectForLane()`: `git-root`/`root-match` bleiben, was
 * sie waren, `fallback` ist kein Projekt.
 *
 * Runner: node --import tsx --test packages/daemon/__tests__/lane-project-confidence.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { runSessionLane } from "../src/session-lane.js";
import { runPromptLane } from "../src/prompt-lane.js";

/** Ein cwd ohne `.git` und ohne Container-Segment — der Fall aus dem Befund.
 *  Der Pfad existiert absichtlich nicht: die Erkennung ist reine Pfadarbeit
 *  plus `existsSync`, und ein nicht existierender Pfad hat garantiert kein
 *  `.git` über sich, egal auf welcher Maschine der Test läuft. */
const GUESSED_CWD = "/Users/x/.buzz";
/** Derselbe Baum mit Container-Segment: `root-match`, muss unverändert
 *  bleiben. */
const DETECTED_CWD = "/Users/x/Projekte/bastra-recall";

const SESSION_CONTEXT_BODY = JSON.stringify({
  budget: {},
  aborted: [],
  data: {
    recalls: [
      {
        scope: "user-preference",
        resp: {
          hits: [
            {
              id: "m1",
              title: "Ein Fakt",
              type: "reference",
              scope: "user-preference",
              summary: "Damit der Block überhaupt gerendert wird.",
              score: 150,
            },
          ],
          vault_size: 1,
          latency_ms: 1,
          recall_id: "r1",
          score_kind: "rrf",
        },
      },
    ],
    floors: [],
    conventions: [],
    care: { open: 0, queued: 0 },
    imports: { open: 0, queued: 0 },
    onboarding: false,
  },
});

const RECALL_BODY = JSON.stringify({
  hits: [
    {
      id: "m1",
      title: "Ein Fakt",
      type: "reference",
      scope: "user-preference",
      summary: "Damit der Block überhaupt gerendert wird.",
      score: 150,
    },
  ],
  vault_size: 1,
  latency_ms: 1,
  recall_id: "r1",
  score_kind: "rrf",
});

interface Captured {
  path: string;
  body: Record<string, unknown>;
}

async function withDaemon(
  bodies: Record<string, string>,
  fn: (baseUrl: string, seen: Captured[]) => Promise<void>,
): Promise<void> {
  const seen: Captured[] = [];
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      if (raw) {
        try {
          seen.push({ path, body: JSON.parse(raw) as Record<string, unknown> });
        } catch {
          /* nicht-JSON interessiert diesen Test nicht */
        }
      }
      const body = bodies[path];
      res.writeHead(body ? 200 : 404, { "content-type": "application/json" });
      res.end(body ?? "{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    await fn(`http://127.0.0.1:${port}`, seen);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

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

const SESSION_BODIES = {
  "/hook/session-context": SESSION_CONTEXT_BODY,
  "/health": JSON.stringify({ ok: true }),
  "/hook/hinted": "{}",
};

const PROMPT_BODIES = {
  "/hook/recall": RECALL_BODY,
  "/hook/reflex": JSON.stringify({ hits: [] }),
  "/hook/hinted": "{}",
};

function context(stdout: string): string {
  const out = JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: string } };
  return out.hookSpecificOutput?.additionalContext ?? "";
}

async function runSession(cwd: string, base: string): Promise<string> {
  return withEnv({ BASTRA_TELEMETRY: "off" }, () =>
    runSessionLane(
      {
        hook_event_name: "SessionStart",
        source: "startup",
        cwd,
        session_id: `proj-conf-${cwd}-${Date.now()}`,
      },
      base,
    ),
  );
}

async function runPrompt(cwd: string, base: string): Promise<string> {
  return withEnv({ BASTRA_TELEMETRY: "off", BASTRA_HOOK_MODE: "all" }, () =>
    runPromptLane(
      {
        hook_event_name: "UserPromptSubmit",
        prompt: "wo ist der Mietvertrag?",
        cwd,
        session_id: `proj-conf-prompt-${cwd}-${Date.now()}`,
      },
      null,
      base,
    ),
  );
}

test("SessionStart mit geratenem Projekt: kein project-Attribut, keine Projekt-Query", async () => {
  await withDaemon(SESSION_BODIES, async (base, seen) => {
    const ctx = context(await runSession(GUESSED_CWD, base));

    assert.ok(ctx.includes("<session-context"), "der Block wird überhaupt gerendert");
    assert.doesNotMatch(ctx, /project="/, "kein Projekt-Attribut auf einem geratenen Namen");
    assert.doesNotMatch(ctx, /\.buzz/, "der geratene Name taucht nirgends im Block auf");

    const posted = seen.filter((s) => s.path === "/hook/session-context");
    assert.equal(posted.length, 1, "die Lane fragt den Assembler genau einmal");
    assert.equal(posted[0].body.project, null, "kein Projekt an den Assembler — also keine Projekt-Query");
  });
});

test("SessionStart mit erkanntem Projekt (root-match): unverändert", async () => {
  await withDaemon(SESSION_BODIES, async (base, seen) => {
    const ctx = context(await runSession(DETECTED_CWD, base));

    assert.match(ctx, /project="bastra-recall"/, "die echte Erkennung trägt weiter ihr Attribut");
    const posted = seen.filter((s) => s.path === "/hook/session-context");
    assert.equal(posted[0].body.project, "bastra-recall");
  });
});

test("Prompt-Lane mit geratenem Projekt: kein project-Attribut, kein Projekt im Recall", async () => {
  await withDaemon(PROMPT_BODIES, async (base, seen) => {
    const ctx = context(await runPrompt(GUESSED_CWD, base));

    assert.ok(ctx.includes("<recall-hints"), "der Block wird überhaupt gerendert");
    assert.doesNotMatch(ctx, /project="/, "kein Projekt-Attribut auf einem geratenen Namen");
    assert.doesNotMatch(ctx, /\.buzz/, "der geratene Name taucht nirgends im Block auf");

    for (const s of seen) {
      assert.equal(s.body.project ?? null, null, `${s.path} darf kein geratenes Projekt tragen`);
    }
  });
});

test("Prompt-Lane mit erkanntem Projekt (root-match): unverändert", async () => {
  await withDaemon(PROMPT_BODIES, async (base, seen) => {
    const ctx = context(await runPrompt(DETECTED_CWD, base));

    assert.match(ctx, /project="bastra-recall"/, "die echte Erkennung trägt weiter ihr Attribut");
    const recall = seen.find((s) => s.path === "/hook/recall");
    assert.ok(recall, "die Lane fragt /hook/recall");
    assert.equal(recall.body.project, "bastra-recall");
  });
});
