/**
 * Tests für das Onboarding-Interview:
 *   - questionsFor — Persona steuert den Katalog (mixed = je erste Frage)
 *   - buildOnboardingMemories — Templates, user-directed, leere Antworten raus
 *   - Marker / isOnboardingNeeded — frisch vs. groß vs. erledigt
 *   - GET/POST /ui/onboarding — ui.enabled-Gating, Save-Pfad, skip
 *
 * Runner: `tsx --test __tests__/onboarding.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request } from "node:http";
import {
  questionsFor,
  buildOnboardingMemories,
  isOnboardingNeeded,
  isOnboardingDone,
  markOnboardingDone,
  handleUiOnboarding,
  ONBOARD_MARKER,
  FRESH_VAULT_MAX,
} from "../src/onboarding.js";

test("questionsFor: persona steers the catalog, mixed gets one follow-up per persona", () => {
  assert.deepEqual(
    questionsFor("developer").map((q) => q.id),
    ["identity", "rules", "stack", "projects", "workflow", "freeform"],
  );
  assert.deepEqual(
    questionsFor("mixed").map((q) => q.id),
    ["identity", "rules", "stack", "role", "world", "freeform"],
  );
  assert.deepEqual(
    questionsFor("personal").map((q) => q.id),
    ["identity", "rules", "world", "remember", "goals", "freeform"],
  );
});

test("buildOnboardingMemories: usage-profile always, one memory per answer, all user-directed", () => {
  const memories = buildOnboardingMemories("developer", {
    identity: "Daniel · German, informal · terse and technical",
    stack: "TypeScript + Node, no ORMs",
    workflow: "   ", // whitespace-only → skipped
  });
  assert.deepEqual(
    memories.map((m) => m.id),
    ["profile-recall-usage", "profile-how-to-address-me", "profile-stack"],
  );
  for (const m of memories) {
    assert.equal(m.write_origin, "user-directed");
    assert.equal(m.overwrite, true);
    assert.equal(m.scope, "user-preference");
    assert.ok((m.recall_when?.length ?? 0) >= 2, `${m.id} needs concrete triggers`);
  }
  assert.match(memories[1].summary, /German, informal/);
});

test("marker: fresh vault needs onboarding, done or big vault does not", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bastra-onboard-"));
  try {
    assert.equal(await isOnboardingNeeded(dir, 3), true);
    assert.equal(await isOnboardingNeeded(dir, FRESH_VAULT_MAX), false, "big vault never nudges");
    await markOnboardingDone(dir, "cli");
    assert.equal(await isOnboardingDone(dir), true);
    assert.equal(await isOnboardingNeeded(dir, 3), false);
    assert.match(await readFile(join(dir, ONBOARD_MARKER), "utf8"), /via cli/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("GET/POST /ui/onboarding: gated on ui.enabled, saves user-directed memories, skip sets marker only", async () => {
  const vaultDir = await mkdtemp(join(tmpdir(), "bastra-onboard-ui-vault-"));
  const settingsDir = await mkdtemp(join(tmpdir(), "bastra-onboard-ui-settings-"));
  const settingsPath = join(settingsDir, "cli-settings.json");
  const server = createServer((req, res) => {
    void handleUiOnboarding(req, res, vaultDir, 3, settingsPath);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const call = (method: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> =>
    new Promise((resolve, reject) => {
      const req = request(
        { hostname: "127.0.0.1", port, path: "/ui/onboarding", method, headers: { "Content-Type": "application/json" } },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(raw) as Record<string, unknown> }),
          );
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });

  try {
    assert.equal((await call("GET")).status, 404, "ui disabled → 404");

    await writeFile(settingsPath, JSON.stringify({ ui: { enabled: true } }));

    const cat = await call("GET");
    assert.equal(cat.status, 200);
    assert.equal(cat.json.needed, true);
    assert.equal((cat.json.personas as unknown[]).length, 4);
    assert.ok((cat.json.questions as unknown[]).length >= 10);

    assert.equal((await call("POST", { persona: "pirate" })).status, 400, "unknown persona rejected");

    const saved = await call("POST", {
      persona: "personal",
      answers: { identity: "Sam · English · warm and brief", world: "Two kids, Berlin, gym on Tuesdays" },
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.saved, 3, "usage-profile + 2 answers");
    const profile = await readFile(
      join(vaultDir, "memories", "user", "profile-how-to-address-me.md"),
      "utf8",
    );
    assert.match(profile, /write_origin: user-directed/);
    assert.equal(await isOnboardingDone(vaultDir), true);

    const again = await call("GET");
    assert.equal(again.json.needed, false, "marker stops the auto-open");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(vaultDir, { recursive: true, force: true });
    await rm(settingsDir, { recursive: true, force: true });
  }
});

test("POST /ui/onboarding skip: marker without any saved memory", async () => {
  const vaultDir = await mkdtemp(join(tmpdir(), "bastra-onboard-skip-vault-"));
  const settingsDir = await mkdtemp(join(tmpdir(), "bastra-onboard-skip-settings-"));
  const settingsPath = join(settingsDir, "cli-settings.json");
  await writeFile(settingsPath, JSON.stringify({ ui: { enabled: true } }));
  const server = createServer((req, res) => {
    void handleUiOnboarding(req, res, vaultDir, 0, settingsPath);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  try {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { hostname: "127.0.0.1", port, path: "/ui/onboarding", method: "POST", headers: { "Content-Type": "application/json" } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ skip: true }));
    });
    assert.equal(status, 200);
    assert.equal(await isOnboardingDone(vaultDir), true);
    await assert.rejects(access(join(vaultDir, "memories")), "no memory written on skip");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await rm(vaultDir, { recursive: true, force: true });
    await rm(settingsDir, { recursive: true, force: true });
  }
});
