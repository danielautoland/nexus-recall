/**
 * Stiller Relay-Kanal für Stop-Hook-Vorschläge (#48 Redesign).
 *
 * Claude-Code-Stop-Hooks haben keinen stillen Output-Kanal: das einzige
 * sichtbare Feld ist `systemMessage`, und das rendert Claude Code 1:1 in den
 * Chat — die „Zeichenflut", die den Hook 2026-05-30 deaktiviert hat. Statt
 * dorthin zu emittieren, schreibt der Stop-Hook seine <save-eval>-Blöcke in
 * diese Datei; der SessionStart-Hook der NÄCHSTEN Session liest sie still als
 * additionalContext ein (für den Agent sichtbar, im Chat unsichtbar) und
 * konsumiert die Datei.
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface PendingSuggestion {
  ts: number;
  blocks: string;
}

const MAX_ENTRIES = 5;
export const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function pendingSuggestionsPath(): string {
  return process.env.BASTRA_PENDING_SUGGESTIONS_PATH ?? join(homedir(), ".bastra", "pending-suggestions.json");
}

/** Append (capped, atomic). Best-effort — never throws. */
export async function writePendingSuggestion(blocks: string): Promise<void> {
  try {
    const path = pendingSuggestionsPath();
    await mkdir(dirname(path), { recursive: true });
    let entries: PendingSuggestion[] = [];
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (Array.isArray(parsed)) entries = parsed as PendingSuggestion[];
    } catch {
      /* missing/corrupt → start fresh */
    }
    entries.push({ ts: Date.now(), blocks });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(entries.slice(-MAX_ENTRIES)), "utf8");
    await rename(tmp, path);
  } catch {
    /* relay is best-effort — never break the Stop hook */
  }
}

/** Read fresh entries and delete the file (consume-once). Never throws. */
export async function consumePendingSuggestions(now: number = Date.now()): Promise<PendingSuggestion[]> {
  const path = pendingSuggestionsPath();
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    await unlink(path).catch(() => {});
    if (!Array.isArray(parsed)) return [];
    return (parsed as PendingSuggestion[]).filter(
      (e) => typeof e?.blocks === "string" && typeof e?.ts === "number" && now - e.ts <= PENDING_MAX_AGE_MS,
    );
  } catch {
    return [];
  }
}
