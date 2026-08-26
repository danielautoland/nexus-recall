/**
 * Codex-Gegenreview Runde 10 — Area-Operationen sind jetzt serialisiert.
 *
 *   - P0-1: Die Grabsteinprüfung im Save lag lange vor dem Publish. Ein Rename,
 *     der dazwischen durchlief, ließ den Save im ALTEN Regal veröffentlichen —
 *     danach existierten beide.
 *   - P0-2: Zwei parallele Renames desselben Namens schrieben beide ihren
 *     Grabstein; in 12 von 12 Läufen zeigte die Marke auf das Ziel des
 *     VERLIERERS.
 *   - P1-1: Ein gewöhnlicher, nachweisbarer Rename-Fehler ließ den vorher
 *     gesetzten Grabstein stehen — das Projekt war danach unbeschreibbar.
 *
 * Runner: node --import tsx --test packages/daemon/__tests__/area-claim-serialization.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAreaMark, saveMemory, withAreaShared, type SaveMemoryInput } from "@bastra-recall/core";
import { createArea, deleteArea, renameArea } from "../src/webui-areas.js";

async function vault(t: { after: (fn: () => unknown) => void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bastra-areaclaim-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "memories", "projects"), { recursive: true });
  return root;
}

function input(over: Partial<SaveMemoryInput> = {}): SaveMemoryInput {
  return {
    id: "m",
    title: "M",
    type: "lesson",
    summary: "s",
    body: "Body.",
    topic_path: ["t"],
    tags: ["t"],
    recall_when: ["t"],
    scope: "carnexus",
    ...over,
  } as SaveMemoryInput;
}

test("ein laufender Save hält seinen Scope — der Rename daneben schreibt keinen Grabstein", async (t) => {
  const root = await vault(t);
  await createArea(root, "carnexus");

  // Der Save wird im Publish-Fenster festgehalten; genau dort lief bisher ein
  // kompletter Rename durch.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const saving = withAreaShared(root, "carnexus", async () => {
    await held;
    return "saved";
  });

  await assert.rejects(
    () => renameArea(root, "project", "carnexus", "neu"),
    /save\(s\) are writing into/,
    "der Rename darf nicht mitten in einen Save laufen",
  );
  // Und er hat nichts hinterlassen: kein Grabstein, kein bewegtes Regal.
  assert.equal(await readAreaMark(root, "carnexus"), null);
  assert.equal(existsSync(join(root, "memories", "projects", "carnexus")), true);
  assert.equal(existsSync(join(root, "memories", "projects", "neu")), false);

  release();
  assert.equal(await saving, "saved");

  // Danach geht der Rename ganz normal.
  await renameArea(root, "project", "carnexus", "neu");
  assert.equal((await readAreaMark(root, "carnexus"))?.to, "neu");
});

test("zwei parallele Renames: die Marke zeigt auf das Regal, das wirklich existiert", async (t) => {
  for (let round = 0; round < 6; round++) {
    const root = await vault(t);
    await createArea(root, "carnexus");
    await saveMemory(root, input());

    const settled = await Promise.allSettled([
      renameArea(root, "project", "carnexus", "ziel-a"),
      renameArea(root, "project", "carnexus", "ziel-b"),
    ]);
    const ok = settled.filter((s) => s.status === "fulfilled");
    assert.equal(ok.length, 1, `genau ein Rename darf gewinnen (Runde ${round})`);

    const winner = (ok[0] as PromiseFulfilledResult<{ name: string }>).value.name;
    const mark = await readAreaMark(root, "carnexus");
    assert.equal(mark?.kind, "renamed");
    assert.equal(
      mark?.to,
      winner,
      `der Grabstein muss auf das existierende Regal zeigen, nicht auf das Ziel des Verlierers (Runde ${round})`,
    );
    assert.equal(existsSync(join(root, "memories", "projects", winner)), true);
    const loser = winner === "ziel-a" ? "ziel-b" : "ziel-a";
    assert.equal(existsSync(join(root, "memories", "projects", loser)), false);
  }
});

test("ein gescheiterter Rename lässt keinen Grabstein zurück", async (t) => {
  const root = await vault(t);
  await createArea(root, "carnexus");
  // Eine DATEI am Zielpfad: `isDir()` sagt nein, `rename()` scheitert trotzdem.
  await writeFile(join(root, "memories", "projects", "neu"), "keine Area", "utf8");

  await assert.rejects(() => renameArea(root, "project", "carnexus", "neu"));
  assert.equal(
    await readAreaMark(root, "carnexus"),
    null,
    "das Regal steht unverändert da — dann darf es auch kein Grabstein sperren",
  );
  assert.equal(existsSync(join(root, "memories", "projects", "carnexus")), true);
  // Und ein Save in die unveränderte Area geht weiterhin.
  const saved = await saveMemory(root, input());
  assert.match(saved.file_path, /projects\/carnexus\//);
});

test("Delete und Create desselben Namens laufen nicht gegeneinander", async (t) => {
  const root = await vault(t);
  await createArea(root, "carnexus");

  const settled = await Promise.allSettled([
    deleteArea(root, "project", "carnexus"),
    createArea(root, "carnexus"),
  ]);
  // Beide Ausgänge sind zulässig — verboten ist nur ein Endzustand, in dem der
  // Ordner existiert UND ein Grabstein ihn sperrt.
  const mark = await readAreaMark(root, "carnexus");
  const dirThere = existsSync(join(root, "memories", "projects", "carnexus"));
  assert.equal(
    dirThere && mark !== null,
    false,
    `lebendes Regal mit Grabstein: ${JSON.stringify({ mark, settled: settled.map((s) => s.status) })}`,
  );
});
