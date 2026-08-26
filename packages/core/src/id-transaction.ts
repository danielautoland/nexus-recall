/**
 * Die ID-Transaktion: der EINE Weg, unter dem eine Memory-ID beansprucht,
 * verschoben, ersetzt oder wiederhergestellt wird.
 *
 * Warum das eine eigene Stelle braucht (Codex-Gegenreview, P0): Der Vault hatte
 * zuletzt zwar einen id-basierten Commit-Lock, aber nur EIN Writer benutzte ihn
 * — `saveMemory`. `saveDocument`, `auditedRestore`, `mutateMemoryFile` und die
 * Area-Writer schrieben daneben vorbei. Nachgestellt: zwei parallele
 * `saveDocument`-Aufrufe für `a+b.pdf` und `a-b.pdf` erzeugten beide ein
 * Sidecar mit der abgeleiteten id `doc-a-b-pdf`, und der Vault lud beim
 * nächsten Start still nur eines davon.
 *
 * Und der Lock allein genügt auch nicht. Unter ihm wurde derselbe Index erneut
 * befragt, aus dem die Vorabprüfung schon ihre Antwort hatte — stammte der aus
 * einem anderen Prozess und war veraltet, meldete auch die zweite Frage `none`.
 * Zwei aufeinanderfolgende Saves derselben id in verschiedene Ordner gelangen
 * beide. Deshalb ist die Auskunft unter dem Lock hier per Default ein
 * autoritativer PLATTEN-Scan, kein Index:
 *
 *     await withIdClaim({ vaultRoot, id, filePath }, async (claim) => {
 *       const located = await claim.locate();   // von der Platte, unter dem Lock
 *       …prüfen, schreiben…
 *     });
 *
 * Die Invariante, die daraus folgt und die dieses Modul trägt: **eine ID, eine
 * Datei, ein transaktionaler Writer.**
 */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { assertInsideVault } from "./file-identity.js";
import { scanVaultForIdAsync, type Located, type MemoryLocator } from "./memory-locator.js";
import {
  acquireCommitClaim,
  commitLockPathFor,
  releaseCommitClaim,
} from "./save-commit.js";

/**
 * Wer beantwortet unter dem Lock die Frage „wo lebt diese id?".
 *
 * Der Default ist der Plattenscan, und das ist die einzige Antwort, die ein
 * Writer im Daemon benutzen darf. Die Schnittstelle existiert für den einen
 * Fall, in dem der Scan nicht bezahlbar ist: ein Bulk-Import, der N Dateien
 * schreibt und mit einem Scan JE DATEI quadratisch würde. Wer hier etwas
 * anderes einsetzt, übernimmt ausdrücklich die Verantwortung dafür, dass seine
 * Quelle für die Dauer des Laufs vollständig ist — der Import tut das, indem
 * er in einem Prozess läuft und die von ihm selbst vergebenen ids mitführt.
 */
export interface IdAuthority {
  locate(id: string): Promise<Located>;
}

/** Der autoritative Scan: liest die Platte, nicht den Index. */
export function diskAuthority(vaultRoot: string): IdAuthority {
  return { locate: (id: string) => scanVaultForIdAsync(vaultRoot, id) };
}

/**
 * Eine synchrone Locator-Auskunft als Authority.
 *
 * NUR für den einen dokumentierten Fall: ein Bulk-Lauf, der in EINEM Prozess
 * viele Dateien schreibt und mit einem Vaultscan je Datei quadratisch würde.
 * Der Snapshot altert währenddessen — wer ihn benutzt, muss die ids, die er
 * selbst vergibt, selbst mitführen (der Folder-Import tut das mit `used`).
 */
export function locatorAuthority(locator: MemoryLocator): IdAuthority {
  return { locate: (id: string) => Promise.resolve(locator.locate(id)) };
}

export interface IdClaim {
  readonly id: string;
  /**
   * Wo lebt diese id — verbindlich, unter dem Lock erhoben.
   *
   * Jeder Aufruf fragt neu. Ein Memoisieren wäre bequem und falsch: Wer
   * innerhalb der Transaktion selbst schreibt, muss danach dieselbe Frage neu
   * stellen dürfen und die Wirkung seines Schreibens sehen.
   */
  locate(): Promise<Located>;
}

export interface IdClaimOptions {
  vaultRoot: string;
  /** Die id, die beansprucht wird — der Lock hängt an ihr, nicht am Pfad. */
  id: string;
  /** Der Pfad, um den es geht. Nur für die Fehlermeldung und die
   *  Containment-Prüfung; der Lock kennt ihn nicht. */
  filePath: string;
  /** Siehe {@link IdAuthority}. Ohne Angabe: Plattenscan. */
  authority?: IdAuthority;
}

/**
 * Die id für die Dauer von `fn` beanspruchen.
 *
 * Nebenbei die zentrale Realpath-Schranke für JEDEN Writer, der hier
 * durchgeht: Sowohl das Ziel als auch das Lock-Verzeichnis müssen real im
 * Vault liegen. Das schließt ein Loch, das bisher schon ein gewöhnlicher
 * `saveMemory` aufriss — ein `.bastra -> /außerhalb`-Symlink ließ das
 * Lock-Verzeichnis außerhalb des Vaults entstehen, weil der Pfad nur
 * zusammengesetzt und nie aufgelöst wurde.
 *
 * Nicht reentrant: Wer innerhalb von `fn` dieselbe id erneut beansprucht,
 * bekommt einen Write-Conflict. Das ist Absicht — ein verschachtelter Anspruch
 * auf dieselbe id ist immer ein Denkfehler im Aufrufer, und ein Fehler ist
 * besser als ein Deadlock.
 */
export async function withIdClaim<T>(
  opts: IdClaimOptions,
  fn: (claim: IdClaim) => Promise<T>,
): Promise<T> {
  assertInsideVault(opts.vaultRoot, opts.filePath);
  const lockPath = commitLockPathFor(opts.vaultRoot, opts.id);
  assertInsideVault(opts.vaultRoot, lockPath, "lock");
  await mkdir(dirname(lockPath), { recursive: true });
  const token = await acquireCommitClaim(lockPath, opts.id, opts.filePath);
  const authority = opts.authority ?? diskAuthority(opts.vaultRoot);
  try {
    return await fn({
      id: opts.id,
      locate: () => authority.locate(opts.id),
    });
  } finally {
    await releaseCommitClaim(lockPath, token);
  }
}
