/**
 * Grabsteine für Areas: Welcher Regalname gehört keiner lebenden Area mehr?
 *
 * Codex-Gegenreview (P0): Ein Area-Rename verschiebt das ganze Regal und
 * schreibt danach die Scopes um. Die Nachprüfung am Ende ERKENNT zwar ein
 * Memory, das den alten Scope behalten hat — sie kann aber nichts gegen einen
 * Save tun, der WÄHREND oder NACH dem Rename mit dem alten Scope kommt.
 * Nachgestellt:
 *
 *   1. `renameArea(carnexus → neu)` startet, das vorhandene Memory ist schon
 *      umgezogen.
 *   2. Ein Save mit `scope: carnexus` legt `memories/projects/carnexus` neu an.
 *   3. Der Rename meldet Erfolg — und danach existieren beide Regale.
 *
 * Eine Marke, die nur „Rename läuft gerade" sagt, reicht dagegen nicht: Der
 * stale Save kann beliebig lange nach dem Rename eintreffen, etwa aus einer
 * Agent-Session, die den alten Projektnamen noch im Kontext hat. Der alte Name
 * muss deshalb DAUERHAFT als vergeben-und-fortgezogen registriert bleiben, bis
 * ihn jemand bewusst wieder in Betrieb nimmt (`createArea` mit demselben
 * Namen).
 *
 * Bewusst kein Lock, sondern ein Grabstein: Ein Lock müsste gegen den ID-Claim
 * in eine Ordnung gebracht werden und wäre nach einem Absturz wieder ein
 * Freigabeproblem. Ein Grabstein ist ein Fakt — er altert nicht, er braucht
 * keine Freigabe, und ein Absturz mitten im Rename lässt ihn stehen, was
 * genau die sichere Richtung ist: Der alte Name bleibt gesperrt, bis jemand
 * hinsieht.
 *
 * Die Marke liegt unter `.bastra/areas/`, also in der privaten Daemon-Ablage,
 * für die dieselben Regeln gelten wie für Trash und Locks: eigenes
 * Unterverzeichnis, kein Symlink.
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { assertInsideDir, assertOwnSubdir } from "./file-identity.js";
import { normalizeScopeKey } from "./scope.js";

const AUDIT_DIR = ".bastra";
const AREAS_DIR = "areas";

/** Was mit einem Regalnamen passiert ist. */
export interface AreaMark {
  kind: "renamed" | "deleted";
  /** Der Name, der nicht mehr gilt — kanonisch. */
  from: string;
  /** Wohin er gezogen ist. Nur bei `renamed`. */
  to?: string;
  /** ISO-Zeitpunkt, damit eine Meldung sagen kann, wann das passiert ist. */
  ts: string;
}

/**
 * Wo die Marke für einen Regalnamen liegt.
 *
 * Der Name wird gehasht statt eingesetzt: Ein Scope darf Zeichen tragen, die
 * `isPathSafeComponent` durchlässt, auf einem anderen Dateisystem aber
 * unbrauchbar sind — dieselbe Begründung wie beim Commit-Lock.
 */
function markPathFor(vaultRoot: string, name: string): string {
  const bastraDir = join(vaultRoot, AUDIT_DIR);
  const areasDir = join(bastraDir, AREAS_DIR);
  assertOwnSubdir(vaultRoot, bastraDir, "mark an area");
  assertOwnSubdir(bastraDir, areasDir, "mark an area");
  const digest = createHash("sha256").update(normalizeScopeKey(name)).digest("hex").slice(0, 32);
  const path = join(areasDir, `${digest}.json`);
  assertInsideDir(areasDir, path, "mark an area", "the areas folder");
  return path;
}

/** Die Marke zu diesem Regalnamen — `null`, wenn der Name frei ist. */
export async function readAreaMark(vaultRoot: string, name: string): Promise<AreaMark | null> {
  let raw: string;
  try {
    raw = await readFile(markPathFor(vaultRoot, name), "utf8");
  } catch (err) {
    // Nur „gibt es nicht" beweist, dass der Name frei ist. Ein Lesefehler ist
    // eine offene Frage und darf nicht als Freigabe durchgehen — dieselbe
    // fail-closed-Regel wie überall sonst im Schreibpfad.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw new Error(
      `cannot tell whether the area '${name}' is still in use ` +
        `(${(err as NodeJS.ErrnoException)?.code ?? String(err)}) — refusing to guess.`,
    );
  }
  try {
    return JSON.parse(raw) as AreaMark;
  } catch {
    // Unlesbarer Inhalt: Der Name IST markiert, wir wissen nur nicht wie.
    // Auch das ist fail-closed zu behandeln.
    return { kind: "deleted", from: normalizeScopeKey(name), ts: "unknown" };
  }
}

/** Marke setzen — atomar, damit ein Absturz keine halbe Datei hinterlässt. */
async function writeMark(vaultRoot: string, name: string, mark: AreaMark): Promise<void> {
  const path = markPathFor(vaultRoot, name);
  await mkdir(join(vaultRoot, AUDIT_DIR, AREAS_DIR), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, JSON.stringify(mark), "utf8");
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Der alte Name eines umbenannten Regals ist ab jetzt vergeben. */
export async function markAreaRenamed(
  vaultRoot: string,
  oldName: string,
  newName: string,
): Promise<void> {
  await writeMark(vaultRoot, oldName, {
    kind: "renamed",
    from: normalizeScopeKey(oldName),
    to: normalizeScopeKey(newName),
    ts: new Date().toISOString(),
  });
}

/** Der Name eines gelöschten Regals ist ab jetzt vergeben. */
export async function markAreaDeleted(vaultRoot: string, name: string): Promise<void> {
  await writeMark(vaultRoot, name, {
    kind: "deleted",
    from: normalizeScopeKey(name),
    ts: new Date().toISOString(),
  });
}

/**
 * Den Namen wieder in Betrieb nehmen. Ausdrücklich NUR für den Fall, dass
 * jemand die Area bewusst neu anlegt — ein Grabstein verfällt nicht von
 * selbst.
 */
export async function clearAreaMark(vaultRoot: string, name: string): Promise<void> {
  await unlink(markPathFor(vaultRoot, name)).catch(() => {});
}

/**
 * Darf in dieses Regal geschrieben werden? Wirft, wenn der Name fortgezogen
 * oder gelöscht ist.
 *
 * Wird im Save-Pfad UNTER dem ID-Claim gerufen: Der Grabstein ist ein Fakt auf
 * der Platte, also braucht er keine eigene Sperre und keine Ordnung gegenüber
 * dem Claim — er wird gelesen wie jede andere autoritative Auskunft auch.
 */
export async function assertAreaWritable(vaultRoot: string, scope: string): Promise<void> {
  const mark = await readAreaMark(vaultRoot, scope);
  if (mark === null) return;
  if (mark.kind === "renamed") {
    throw new Error(
      `the area '${scope}' was renamed to '${mark.to}'${mark.ts !== "unknown" ? ` on ${mark.ts.slice(0, 10)}` : ""} — ` +
        `save with scope '${mark.to}' instead. Writing to the old name would recreate the shelf ` +
        `that was just moved away. If you really want '${scope}' back as a separate area, ` +
        `create it explicitly first.`,
    );
  }
  throw new Error(
    `the area '${scope}' was deleted${mark.ts !== "unknown" ? ` on ${mark.ts.slice(0, 10)}` : ""} — ` +
      `writing to it would silently revive it. Create it explicitly first if that is what you want.`,
  );
}
