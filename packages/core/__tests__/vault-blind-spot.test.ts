/**
 * Codex-Gegenreview (P0): Ein unlesbares Vault-Unterverzeichnis wurde wie ein
 * LEERES behandelt.
 *
 * `Vault.walkDir()` schluckte den `readdir`-Fehler und lieferte eine leere
 * Liste. Zwei nachgestellte Folgen, beide still:
 *
 *   - Ein vor `init()` unlesbar gemachtes Verzeichnis enthielt bereits eine
 *     id. Der Vault sah sie nicht und ließ ein zweites Memory mit derselben
 *     id zu.
 *   - Wurde ein Ordner NACH dem Laden unlesbar, entfernte `reconcile()` die
 *     dortigen Memories aus dem Index, obwohl die Dateien noch existierten.
 *
 * „Nicht lesbar" ist keine Aussage über den Inhalt. Der Scan muss seine
 * blinden Flecken melden, und jeder besitzverändernde Writer muss daran
 * scheitern statt zu raten.
 *
 * Runner: node --import tsx --test packages/core/__tests__/vault-blind-spot.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault, saveMemory } from "../src/index.js";

function memoryMarkdown(id: string): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${id}`,
    "type: lesson",
    "summary: s",
    "topic_path:",
    "  - test",
    "tags:",
    "  - test",
    "scope: proj",
    "recall_when:",
    "  - probe",
    "created: 2026-08-01",
    "updated: 2026-08-01",
    "---",
    "",
    "Body.",
    "",
  ].join("\n");
}

/** Ein Ordner mit einem Memory darin, danach unlesbar gemacht. */
async function vaultWithSealedShelf(prefix: string): Promise<{ root: string; sealed: string }> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const sealed = join(root, "memories", "projects", "sealed");
  await mkdir(sealed, { recursive: true });
  await writeFile(join(sealed, "hidden.md"), memoryMarkdown("hidden"), "utf8");
  return { root, sealed };
}

test("ein unlesbarer Ordner ist ein gemeldeter blinder Fleck, kein leerer Ordner", async (t) => {
  const { root, sealed } = await vaultWithSealedShelf("bastra-blind-init-");
  await chmod(sealed, 0o000);
  t.after(async () => {
    await chmod(sealed, 0o755).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  const vault = new Vault(root);
  const { skipped } = await vault.init();
  t.after(() => vault.stop());

  assert.ok(
    skipped.some((s) => s.path === sealed),
    "der unlesbare Ordner muss im init-Report auftauchen",
  );
  assert.deepEqual(vault.scanBlindSpots(), [sealed]);
});

test("hinter einem blinden Fleck darf kein zweites Memory derselben id entstehen", async (t) => {
  const { root, sealed } = await vaultWithSealedShelf("bastra-blind-save-");
  await chmod(sealed, 0o000);
  t.after(async () => {
    await chmod(sealed, 0o755).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  // Der autoritative Plattenscan der ID-Transaktion sieht denselben blinden
  // Fleck — und darf deshalb nicht behaupten, die id sei frei.
  await assert.rejects(
    saveMemory(root, {
      id: "hidden",
      title: "Hidden",
      type: "lesson",
      summary: "s",
      body: "zweite Datei",
      topic_path: ["test"],
      tags: ["test"],
      scope: "proj",
      recall_when: ["probe"],
    }),
    /could not read/,
  );
});

test("reconcile wirft nichts aus dem Index, was es nur nicht mehr lesen kann", async (t) => {
  const { root, sealed } = await vaultWithSealedShelf("bastra-blind-reconcile-");
  t.after(async () => {
    await chmod(sealed, 0o755).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  const vault = new Vault(root);
  await vault.init();
  t.after(() => vault.stop());
  assert.ok(vault.get("hidden"), "Kontrolle: geladen, solange der Ordner lesbar ist");

  // Jetzt wird der Ordner unlesbar — die Datei bleibt aber liegen.
  await chmod(sealed, 0o000);
  await vault.reconcile();

  assert.ok(
    vault.get("hidden"),
    "ein unlesbarer Ordner ist kein gelöschtes Memory — der Index darf ihn nicht vergessen",
  );
  assert.deepEqual(vault.scanBlindSpots(), [sealed]);
});

/**
 * Codex-Gegenreview (P1): Phantom-Duplikat nach Änderung einer
 * quarantänisierten id.
 *
 * Zwei Dateien tragen dieselbe id, die zweite wird quarantäniert. Bekommt sie
 * anschließend eine ANDERE id, wurde sie zwar korrekt unter der neuen id
 * indexiert — ihr Pfad blieb aber im Duplicate-Set der alten stehen. Danach
 * erschien sie unter beiden ids, und `pathsFor(alt)` meldete `ambiguous` für
 * einen Zustand, den es nicht mehr gibt: Jeder Save auf die alte id war damit
 * blockiert.
 */
test("wer neu indexiert wird, ist kein quarantänisiertes Duplikat mehr", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bastra-phantom-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = join(root, "a.md");
  const second = join(root, "b.md");
  await writeFile(first, memoryMarkdown("zwilling"), "utf8");
  await writeFile(second, memoryMarkdown("zwilling"), "utf8");

  const vault = new Vault(root);
  await vault.init();
  t.after(() => vault.stop());
  assert.deepEqual(
    vault.pathsFor("zwilling").sort(),
    [first, second].sort(),
    "Kontrolle: der zweite Pfad ist als Duplikat bekannt",
  );

  // Der Konflikt wird aufgelöst — die zweite Datei bekommt eine eigene id.
  await writeFile(second, memoryMarkdown("eigenstaendig"), "utf8");
  await vault.reindexFile(second);

  assert.deepEqual(
    vault.pathsFor("zwilling"),
    [first],
    "die umbenannte Datei darf nicht weiter als Duplikat der alten id gelten",
  );
  assert.deepEqual(vault.pathsFor("eigenstaendig"), [second]);
});
