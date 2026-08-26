/**
 * Ein Memory-File ändern, ohne es zu verlieren.
 *
 * Der Vault hat mehrere Writer, die nicht der Save-Pfad sind: Conflict-Marking
 * hängt einen Block an, `superseded_by` stempelt eine Kante, das Archiv setzt
 * `obsolete`. Jeder tat es auf eigene Weise, und zwei Muster kamen dabei immer
 * wieder vor (Codex-Audit, P1):
 *
 *   - Ein direktes `writeFile` auf die Zieldatei. Das lässt sie kurzzeitig
 *     leer oder halb geschrieben — ein Fenster, in dem Watcher, Cloud-Sync und
 *     jeder parallele Reader eine kaputte Datei sehen. Genau deshalb schreibt
 *     der Save-Pfad seit jeher temp+rename.
 *   - Kein Vergleich zwischen Read und Commit. Wer zwischendurch schreibt,
 *     verliert: Der Transformierende rechnet auf dem alten Inhalt und macht
 *     die fremde Änderung mit seinem Rename rückgängig.
 *
 * Dazu kommt die Identitätsfrage, die dieselbe ist wie im Save-Pfad: Ein Pfad
 * beweist nicht, welches Memory dort liegt. Wer `superseded_by` auf eine Datei
 * stempelt, muss wissen, dass es die gemeinte ist.
 *
 * Prozessübergreifend gesperrt wird über die ID-Transaktion: Wer `vaultRoot`
 * mitgibt (jeder produktive Aufrufer tut das), läuft unter demselben id-Lock
 * wie der Save-Pfad. Codex-Gegenreview (P0): Ohne ihn lag zwischen Read und
 * Rename ein Fenster, in dem ein anderer Writer schrieb — und dessen Änderung
 * machte der Rename hier still rückgängig. Der Vergleich vor dem Commit
 * schließt das Fenster nicht, er erkennt nur, dass es zugeschlagen hat.
 */
import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import matter from "gray-matter";
import { occupantOfRaw } from "./memory-locator.js";
import { withIdClaim } from "./id-transaction.js";

export type MutateOutcome =
  /** Geschrieben. */
  | { kind: "written" }
  /** Der Patch hatte nichts zu tun (`frontmatter` gab `null` zurück). Kein
   *  Fehlschlag — die Datei steht schon so da, wie sie soll.
   *
   *  Codex-Gegenreview (P0): Das meldete diese Funktion früher ebenfalls als
   *  `raced`, und damit konnte kein Aufrufer „nichts zu tun" von „jemand hat
   *  dazwischengeschrieben, mein Stempel liegt NICHT drauf" unterscheiden. Wer
   *  die Vollständigkeit einer Operation prüfen will (der Area-Rename tut das),
   *  braucht genau diese Unterscheidung. */
  | { kind: "noop" }
  /** Zwischen Read und Commit hat jemand anderes geschrieben — nichts getan. */
  | { kind: "raced" }
  /** Die Datei hält nicht das erwartete Memory — nichts getan. */
  | { kind: "identity-mismatch"; found: string | null };

export interface MemoryMutation {
  /** Frontmatter-Patch. Rückgabe `null` heißt „nichts zu tun" und liefert
   *  {@link MutateOutcome} `noop` — ausdrücklich kein Fehlschlag. */
  frontmatter?: (fm: Record<string, unknown>) => Record<string, unknown> | null;
  /** Body-Transformation. */
  body?: (body: string) => string;
}

/**
 * Frontmatter und/oder Body eines Memory-Files ändern.
 *
 * @param filePath Die Datei, die geändert werden soll.
 * @param expectedId Welches Memory dort liegen MUSS. `null` überspringt die
 *   Identitätsprüfung — nur für Dateien, die per Definition kein indexiertes
 *   Memory mehr sind (der Archiv-Stempel auf einer Datei im Trash).
 */
export async function mutateMemoryFile(
  filePath: string,
  expectedId: string | null,
  mutation: MemoryMutation,
  opts: MutateOptions = {},
): Promise<MutateOutcome> {
  // Ohne id oder ohne Vault gibt es nichts zu sperren: Der Trash-Stempel
  // (expectedId === null) trifft eine Datei, die per Definition kein
  // indexiertes Memory mehr ist, und ein Aufrufer ohne `vaultRoot` kann den
  // Lock-Pfad gar nicht bilden. Beides bleibt beim Compare-and-Swap allein.
  if (opts.vaultRoot === undefined || expectedId === null) {
    return mutateUnderClaim(filePath, expectedId, mutation);
  }
  return withIdClaim({ vaultRoot: opts.vaultRoot, id: expectedId, filePath, op: opts.op ?? "mutate" }, () =>
    mutateUnderClaim(filePath, expectedId, mutation),
  );
}

export interface MutateOptions {
  /** Welcher Writer hier mutiert — geht in die Scan-Messung ein. */
  op?: string;
  /** Der Vault, unter dessen ID-Transaktion die Mutation laufen soll. Jeder
   *  produktive Aufrufer gibt ihn mit; ohne ihn bleibt es beim
   *  Compare-and-Swap ohne prozessübergreifende Sperre. */
  vaultRoot?: string;
}

async function mutateUnderClaim(
  filePath: string,
  expectedId: string | null,
  mutation: MemoryMutation,
): Promise<MutateOutcome> {
  // EIN Read für alles: Identität, Transform und der Vergleich vor dem Commit
  // müssen auf denselben Bytes beruhen. Vorher las die Identitätsprüfung die
  // Datei separat (`readOccupant`) und der Transform ein zweites Mal — zwischen
  // beiden Reads liegt ein await, und wer dort die Datei durch ein anderes
  // Memory ersetzt, bekommt die Prüfung der einen Fassung und den Stempel auf
  // der anderen.
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    // Ohne Identitätsanspruch (Trash-Stempel) ist ein Lesefehler ein echter
    // Fehler; mit Anspruch ist er schlicht der Beweis, dass das erwartete
    // Memory hier nicht liegt.
    if (expectedId === null) throw err;
    return { kind: "identity-mismatch", found: null };
  }

  if (expectedId !== null) {
    const occupant = occupantOfRaw(raw, filePath);
    if (occupant.kind !== "memory" || occupant.id !== expectedId) {
      return {
        kind: "identity-mismatch",
        found: occupant.kind === "memory" ? occupant.id : null,
      };
    }
  }

  const parsed = matter(raw);
  // Copy statt in-place: gray-matter cached `matter(content)` per Input-String,
  // eine Mutation von `parsed.data` vergiftet den Cache-Eintrag für jeden
  // späteren Parser desselben Inhalts.
  const fmBefore = { ...(parsed.data as Record<string, unknown>) };
  const fmAfter = mutation.frontmatter ? mutation.frontmatter(fmBefore) : fmBefore;
  if (fmAfter === null) return { kind: "noop" };
  const bodyAfter = mutation.body ? mutation.body(parsed.content) : parsed.content;
  const next = matter.stringify(bodyAfter, fmAfter);

  // Eindeutig je SCHREIBVORGANG, nicht je Prozess: Zwei überlappende
  // Mutationen derselben Datei im selben Prozess teilten sich sonst die
  // Zwischendatei und rannten um das Rename (#240/B3).
  const tmp = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.mutate.tmp`;
  await writeFile(tmp, next, "utf8");
  try {
    const current = await readFile(filePath, "utf8").catch(() => null);
    if (current !== raw) {
      await unlink(tmp).catch(() => {});
      return { kind: "raced" };
    }
    await rename(tmp, filePath);
    return { kind: "written" };
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}
