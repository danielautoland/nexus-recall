import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Persistenz für den In-Memory-Korrelations-State der Telemetry (Audit 26.6.).
 *
 * lastRecall/hookHints/turns/loadedMemories leben sonst nur im Daemon-Prozess
 * und gehen bei jedem Idle-Respawn verloren — dann werden follows_recall /
 * from_hook_recall / recall_episode still null (boot-übergreifend kein Join).
 * Ein atomarer JSON-Snapshot, den jeder Boot wieder einliest, schließt die
 * Lücke unabhängig davon, ob der Daemon zwischendurch neu gestartet ist.
 *
 * Bewusst plain JSON statt SQLite: der State ist klein und kurzlebig (Minuten-
 * TTL). Gelesen wird SYNC beim Boot (vermeidet eine Init-Race mit eingehenden
 * Tool-Calls), geschrieben async + atomar (tmp + rename).
 */

/** Sync read beim Boot — fehlend/korrupt → null (frischer Start, nie ein Throw). */
export function readJoinStateSync(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Atomarer Write: tmp (pid-eindeutig) + rename auf demselben Dateisystem. */
export async function writeJoinState(path: string, state: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state), "utf8");
  await rename(tmp, path);
}
