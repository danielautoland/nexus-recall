/**
 * Welche Datei ist das WIRKLICH — und liegt sie im Vault?
 *
 * Beide Fragen wurden im Schreibpfad über Pfad-STRINGS beantwortet, und beide
 * Antworten waren falsch, sobald das Dateisystem nicht buchstabengetreu ist:
 *
 *   - Re-Filing verglich `previous.filePath !== result.file_path`. Auf APFS
 *     (case-insensitiv) trifft ein Save mit `folder: memories/people` die
 *     bestehende Datei `memories/People/case-id.md`, meldet aber die andere
 *     Schreibweise zurück. Der Stringvergleich hielt die beiden für zwei
 *     Dateien und schob die „alte" in den Trash — dieselbe Datei, die gerade
 *     geschrieben worden war. Ergebnis: „Save complete", und danach existiert
 *     keiner der beiden gemeldeten Pfade mehr.
 *
 *   - Die Containment-Prüfung war lexikalisch (`resolve(p).startsWith(root)`).
 *     Ein Symlink `memories/linked -> /outside` plus `folder: memories/linked`
 *     erzeugte damit erfolgreich `/outside/escaped.md`: der String beginnt
 *     brav mit dem Vault-Pfad, das Dateisystem geht trotzdem woanders hin.
 *
 * Die Antwort auf beides ist dieselbe: nicht den Pfad fragen, sondern das
 * Dateisystem. Identität über `dev`/`ino`, Containment über `realpath` des
 * tiefsten bereits EXISTIERENDEN Vorfahren — der Zielpfad selbst existiert
 * beim Schreiben ja noch nicht. `auditedRestore` in `audit-save.ts` macht das
 * seit Codex-Befund 6a schon so; hier steht es wiederverwendbar.
 *
 * Bewusst synchron: `resolveMemoryTarget` ist ein synchrones Routing-Primitiv,
 * das auch der Audit-Pfad ohne `await` aufruft.
 */
import { realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

/**
 * Sind das zwei Namen für DIESELBE Datei?
 *
 * Über `dev`/`ino`, nicht über den Pfad: ein case-insensitives Dateisystem,
 * ein Symlink, ein Hardlink oder ein Unicode-normalisierender Mount lassen
 * dieselbe Datei unter mehreren Schreibweisen erscheinen.
 *
 * Existiert eine der beiden nicht (oder ist sie unlesbar), lautet die Antwort
 * `false` — „nicht nachweisbar dieselbe". Für den Aufrufer ist das die sichere
 * Richtung: er behandelt sie dann als getrennte Dateien und räumt keine auf,
 * die er nicht sehen kann.
 */
export function sameFile(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const statA = statSync(a);
    const statB = statSync(b);
    return statA.dev === statB.dev && statA.ino === statB.ino;
  } catch {
    return false;
  }
}

/**
 * Der reale Pfad eines Ziels, das es noch nicht gibt: den tiefsten bereits
 * existierenden Vorfahren auflösen und den Rest wieder anhängen. So hilft ein
 * Symlink auf halbem Weg nicht mehr aus dem Vault heraus.
 */
export function realpathOfNearestExisting(p: string): string {
  const tail: string[] = [];
  let probe = resolve(p);
  for (;;) {
    let real: string | undefined;
    try {
      real = realpathSync(probe);
    } catch {
      real = undefined;
    }
    if (real !== undefined) return tail.length === 0 ? real : join(real, ...tail);
    const parent = dirname(probe);
    // Bei der Wurzel angekommen, ohne dass irgendetwas existierte.
    if (parent === probe) return resolve(p);
    tail.unshift(basename(probe));
    probe = parent;
  }
}

/**
 * Liegt `dest` REAL im Vault? Wirft, wenn nicht.
 *
 * Auch der Vault-Root wird über den tiefsten existierenden Vorfahren
 * aufgelöst: Ein frisch angelegter Vault existiert beim ersten Save noch
 * nicht, und `/var` ist auf macOS selbst ein Symlink — ohne beidseitige
 * Auflösung schlüge die Prüfung dort für jeden legitimen Pfad fehl.
 */
export function assertInsideVault(vaultRoot: string, dest: string, action = "write"): void {
  const vaultReal = realpathOfNearestExisting(vaultRoot);
  const destReal = realpathOfNearestExisting(dest);
  if (destReal !== vaultReal && !destReal.startsWith(vaultReal + sep)) {
    throw new Error(
      `refusing to ${action} outside the vault: ${dest} resolves to ${destReal}, ` +
        `which is not inside ${vaultReal}.`,
    );
  }
}
