/**
 * Live updates (#216) — a small ring buffer of vault events, fed by the
 * vault watcher (+ the load path for "read"), polled by the map
 * (`GET /ui/updates?since=<ms>`). The universe view turns "add" entries
 * into supernovae; every kind lands as a notice card + session history.
 *
 * Deliberately a poll, not a push: one tiny JSON answer every few seconds
 * beats a standing event-stream connection for exactly one consumer, and
 * the buffer is bounded so an import burst can't grow memory.
 *
 * Kinds & anti-spam rules (one entry per id, hotter kinds win):
 *   - add     — new memory. Replaces any older entry for the id.
 *   - change  — edited memory. SUPPRESSED while an "add" entry for the id
 *               is still live (save → enrich → reindex fires several change
 *               events right after birth; the newborn must stay "new").
 *   - delete  — removed memory. Always wins; title comes from the last
 *               known entry (the file is already gone).
 *   - read    — load_memory touched it. Weakest kind: never overwrites an
 *               add/change/delete entry, only refreshes its own.
 * Gleichartige Folge-Events innerhalb von 60s (Enricher-Doppel-Writes,
 * Re-Reads, Watcher/Reindex-Races) frischen nur die Daten auf und behalten
 * ihr `at` — der Client announced sie dadurch nicht erneut.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { clusterKeyFor, type Memory, type Vault } from "@bastra-recall/core";
import { sendJsonPlain } from "./webui.js";
import { getUiEnabled } from "./settings.js";

export type LiveUpdateKind = "add" | "change" | "delete" | "read";

export interface LiveUpdate {
  id: string;
  kind: LiveUpdateKind;
  title: string;
  type: string;
  scope: string;
  cluster: string;
  summary: string;
  at: number; // ms epoch when the daemon saw the event
  /** #217 Valenz: der Newborn soll sofort mit Emotionsfarbe glühen — die Map
   *  adoptiert ihn als echten Node, ohne auf den Graph-Reload zu warten. */
  salience?: number;
  emotion?: string;
}

const MAX_ENTRIES = 50;
const MAX_AGE_MS = 10 * 60 * 1000; // entries older than this stop being served
const REANNOUNCE_COOLDOWN_MS = 60 * 1000;

export function createLiveUpdates(vault: Vault): {
  handleUiUpdates: (req: IncomingMessage, res: ServerResponse, settingsPath?: string) => Promise<void>;
  notifyRead: (id: string) => void;
  stop: () => void;
} {
  const recent: LiveUpdate[] = [];

  const entryFor = (m: Memory, kind: LiveUpdateKind): LiveUpdate => ({
    id: m.fm.id,
    kind,
    title: m.fm.title,
    type: m.fm.type,
    scope: m.fm.scope,
    cluster: clusterKeyFor(m, vault.root),
    summary: m.fm.summary,
    at: Date.now(),
    ...(typeof m.fm.salience === "number" ? { salience: m.fm.salience } : {}),
    ...(m.fm.emotion ? { emotion: m.fm.emotion } : {}),
  });

  const push = (entry: LiveUpdate): void => {
    const idx = recent.findIndex((e) => e.id === entry.id);
    const existing = idx >= 0 ? recent[idx] : null;
    const fresh = existing !== null && Date.now() - existing.at < MAX_AGE_MS;
    if (fresh && existing) {
      // one entry per id — hotter kinds win, siehe Header-Regeln
      if (entry.kind === "change" && existing.kind === "add") return;
      if (entry.kind === "read" && existing.kind !== "read") return;
      if (entry.kind === existing.kind && entry.at - existing.at < REANNOUNCE_COOLDOWN_MS) {
        // rasche Folge-Events gleicher Art: Daten auffrischen, `at` behalten
        // → der Client (since-Filter + known-Set) announced nicht erneut
        recent[idx] = { ...entry, at: existing.at };
        return;
      }
    }
    if (idx >= 0) recent.splice(idx, 1);
    recent.push(entry);
    trim();
  };

  const trim = (): void => {
    if (recent.length > MAX_ENTRIES) recent.splice(0, recent.length - MAX_ENTRIES);
  };

  const unsubscribe = vault.on((e) => {
    if (e.kind === "add") push(entryFor(e.memory, "add"));
    else if (e.kind === "change") push(entryFor(e.memory, "change"));
    else if (e.kind === "remove") {
      // das File ist weg — Titel/Cluster aus dem letzten bekannten Eintrag
      const known = recent.find((x) => x.id === e.id);
      push({
        id: e.id,
        kind: "delete",
        title: known?.title ?? e.id,
        type: known?.type ?? "memory",
        scope: known?.scope ?? "",
        cluster: known?.cluster ?? "",
        summary: known?.summary ?? "",
        at: Date.now(),
      });
    }
  });

  /** "read"-Notice vom load_memory-Pfad (via Telemetry-Hook, best-effort). */
  const notifyRead = (id: string): void => {
    try {
      const m = vault.get(id);
      if (m) push(entryFor(m, "read"));
    } catch {
      /* Notices sind Telemetrie-of-Telemetrie — nie einen Load brechen */
    }
  };

  async function handleUiUpdates(
    req: IncomingMessage,
    res: ServerResponse,
    settingsPath?: string,
  ): Promise<void> {
    if (!(await getUiEnabled(settingsPath))) {
      sendJsonPlain(res, 404, { error: "ui disabled" });
      return;
    }
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    const since = Number(u.searchParams.get("since") ?? 0) || 0;
    const now = Date.now();
    const updates = recent.filter((e) => e.at > since && now - e.at < MAX_AGE_MS);
    sendJsonPlain(res, 200, { updates, now });
  }

  return { handleUiUpdates, notifyRead, stop: unsubscribe };
}
