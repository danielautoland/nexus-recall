/**
 * Split out of `save.ts` (#360 follow-up): the write path had grown past 800
 * lines, which is a context cost on every edit that touches it. Pure move —
 * no behaviour change, no renamed export.
 *
 * Commit claims — the file-level lock that keeps two writers from claiming one
 * id. Split from the save orchestration because it answers a different
 * question: not "what does this memory look like" but "may I write right now".
 *
 * The claim outlives its process on SIGKILL, OOM or power loss, so age is a
 * release criterion — but only for a claim whose owner cannot be shown to be
 * alive. Details on each rule are at the function that implements it.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile, access, open, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { MemoryWriteConflictError } from "./save-schema.js";

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a commit snapshot without treating I/O failures as "missing".
 * `access()`-style probes collapse EACCES/EIO and ENOENT; a writer must fail
 * closed because only ENOENT proves that an id is free.
 */
export async function readTarget(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * How long a commit claim may sit untouched before a later writer may take it.
 * The commit it guards is a read plus a link/rename — milliseconds. The margin
 * is for a stalled cloud mount, not for a slow write.
 */
const COMMIT_CLAIM_STALE_MS = 30_000;

/**
 * A claim names its owner so a later writer can tell "someone is committing"
 * from "someone died mid-commit". Without this the claim outlives the process
 * that took it — `finally` does not run on SIGKILL, OOM or power loss — and the
 * id stays unwritable forever.
 */
interface CommitClaim {
  pid: number;
  host: string;
  ts: number;
  /** Wer diesen Claim genommen hat — je Erwerb neu, nicht je Prozess.
   *
   *  Codex-Gegenreview (P1): Freigegeben wurde per blindem `unlink`. Zwei
   *  Writer, die denselben verwaisten Claim gleichzeitig einsammeln, löschen
   *  sich danach gegenseitig den frisch genommenen Lock — und ein dritter
   *  Writer läuft in die entstandene Lücke. Der Release prüft deshalb, ob der
   *  Claim auf der Platte noch DERSELBE ist. */
  token: string;
}

/**
 * May this writer take a claim it found already present?
 *
 * Zwei unabhängige Gründe, und der BESITZER kommt zuerst: Lebt der eingetragene
 * Prozess auf dieser Maschine noch, ist der Claim in Benutzung, egal wie alt er
 * ist. Das Alter bleibt für alles andere zuständig — ein fremder Host (eine PID
 * ist nur auf ihrer Maschine aussagekräftig, und der Vault liegt erwartbar auf
 * geteilten Cloud-Mounts) oder ein unparsebarer Claim.
 */
export async function claimIsAbandoned(lockPath: string): Promise<boolean> {
  let raw: string;
  let ageMs: number;
  try {
    const [content, info] = await Promise.all([
      readFile(lockPath, "utf8"),
      stat(lockPath),
    ]);
    raw = content;
    ageMs = Date.now() - info.mtimeMs;
  } catch (err) {
    // Gone between EEXIST and here — another writer already cleared it, so this
    // one is free to retry. Anything else stays a conflict: unknown is not free.
    return (err as NodeJS.ErrnoException)?.code === "ENOENT";
  }

  // Erst der Besitzer, dann das Alter. Codex-Gegenreview (P1): Die Reihenfolge
  // war umgekehrt, und damit enteignete ein zweiter Writer nach 30 Sekunden
  // einen Claim, dessen Besitzer auf DIESER Maschine nachweislich noch lief
  // und gerade schrieb — ein langsamer Cloud-Mount reicht dafür aus. Ein
  // lebender lokaler Prozess ist ein Beweis, das Alter nur ein Indiz.
  let claim: CommitClaim | undefined;
  try {
    claim = JSON.parse(raw) as CommitClaim;
  } catch {
    claim = undefined;
  }
  if (claim && claim.host === hostname() && typeof claim.pid === "number") {
    try {
      process.kill(claim.pid, 0);
      return false; // owner is alive and working — age says nothing here
    } catch (err) {
      // ESRCH: der Besitzer ist weg, der Claim ist sofort frei. Alles andere
      // (EPERM — fremder Nutzer, gleiche PID) bleibt eine Altersfrage.
      if ((err as NodeJS.ErrnoException)?.code === "ESRCH") return true;
    }
  }
  // Fremder Host, unparsebarer oder nicht zuordenbarer Claim: nur das Alter
  // kann ihn noch freigeben.
  return ageMs > COMMIT_CLAIM_STALE_MS;
}

/**
 * Take the commit claim, reclaiming it once if the previous owner provably
 * died. A single retry is deliberate: two writers racing to reclaim the same
 * dead claim means one wins and the other reports a conflict, which is the
 * documented outcome for contention and costs no data — the compare-and-swap
 * below still has to agree before anything is published.
 */
export async function acquireCommitClaim(
  lockPath: string,
  id: string,
  filePath: string,
): Promise<string> {
  const token = randomUUID();
  const body = JSON.stringify({
    pid: process.pid,
    host: hostname(),
    ts: Date.now(),
    token,
  } satisfies CommitClaim);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(body, "utf8");
      } finally {
        await handle.close();
      }
      return token;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
      if (attempt === 0 && (await claimIsAbandoned(lockPath))) {
        await unlink(lockPath).catch(() => {});
        continue;
      }
      throw writeConflict(id, filePath, "another save is committing this target");
    }
  }
  /* c8 ignore next */
  throw writeConflict(id, filePath, "another save is committing this target");
}

/**
 * Den eigenen Claim freigeben — und NUR den eigenen.
 *
 * Codex-Gegenreview (P1): Der Release war ein blindes `unlink`. Wurde der
 * Claim zwischenzeitlich als verwaist eingesammelt (langsamer Mount, 30s
 * überschritten), löschte der Nachzügler beim Aufräumen den Lock seines
 * Nachfolgers — und der übernächste Writer lief in eine Lücke, die es nach
 * dem Modell gar nicht geben darf. Der Token beweist Besitz; passt er nicht,
 * gehört der Lock jemand anderem und bleibt stehen.
 */
export async function releaseCommitClaim(lockPath: string, token: string): Promise<void> {
  try {
    const raw = await readFile(lockPath, "utf8");
    const claim = JSON.parse(raw) as CommitClaim;
    if (claim.token !== token) return; // nicht mehr unserer
  } catch {
    // Weg, unlesbar oder unparsebar: nichts davon ist nachweislich unser Lock.
    // Stehen lassen — er altert aus, statt dass wir den eines anderen löschen.
    return;
  }
  await unlink(lockPath).catch(() => {});
}

export function writeConflict(id: string, filePath: string, detail: string): MemoryWriteConflictError {
  return new MemoryWriteConflictError(id, filePath, detail);
}

/**
 * Der Lock-Pfad für eine Memory-ID — nicht für einen Zielpfad.
 *
 * Codex-Gegenreview: Der Commit-Claim lag auf `<zielpfad>.bastra-write.lock`.
 * Zwei gleichzeitige Saves DERSELBEN id in verschiedene `folder`-Regale
 * nahmen damit zwei verschiedene Locks und gelangen beide — danach trugen
 * zwei Dateien dieselbe id, und der Vault lud beim nächsten Start still nur
 * eine davon. Der Kommentar über dem Lock sprach schon von der id; die
 * Umsetzung tat es nicht.
 *
 * Der Lock liegt unter `.bastra/locks/`, weil er sonst als Datei NEBEN dem
 * Memory läge und beim Re-Filing im falschen Regal zurückbliebe. Der
 * id-Anteil wird gehasht statt eingesetzt: Eine id darf Zeichen tragen, die
 * `isPathSafeComponent` durchlässt, aber auf einem anderen Dateisystem
 * unbrauchbar sind — und der Lock muss auf JEDEM funktionieren, gerade auf
 * den Cloud-Mounts, für die er da ist.
 */
export function commitLockPathFor(vaultRoot: string, id: string): string {
  const digest = createHash("sha256").update(id).digest("hex").slice(0, 32);
  return join(vaultRoot, ".bastra", "locks", `${digest}.bastra-write.lock`);
}
