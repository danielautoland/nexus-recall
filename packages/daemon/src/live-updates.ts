/**
 * Live updates (#216, #234) — a lossless event log of vault activity, fed by
 * the vault watcher (+ the load path for "read"), polled by the map
 * (`GET /ui/updates?since=<seq>`). The universe view turns "add" entries into
 * supernovae; every kind lands as a notice card + session history.
 *
 * Deliberately a poll, not a push: one tiny JSON answer every few seconds beats
 * a standing event-stream connection for exactly one consumer, and the buffer
 * is bounded so an import burst can't grow memory.
 *
 * Two guarantees (#234):
 *   1. Coalescing — rapid events on the SAME memory (an agent re-reading it, a
 *      save → enrich → reindex burst) collapse into ONE entry that finalizes
 *      only after DEBOUNCE_MS of quiet for that id, carrying a `count` (×N).
 *      DIFFERENT memories never collapse together — each keeps its own timer.
 *   2. Lossless delivery — every finalized entry gets a monotone `seq`; the
 *      client polls with the last seq it saw and receives every entry with a
 *      higher seq. The ring buffer is large and never age-drops undelivered
 *      entries; if it truly overflows, the smallest surviving seq jumps past
 *      the client's cursor, which the client detects (minSeq > since + 1) and
 *      surfaces honestly as "+N older changes" instead of silently dropping.
 *
 * Kinds (hottest wins while coalescing): delete > add > change > read.
 *   - add     — new memory (→ supernova). Survives a following enrich burst.
 *   - change  — edited memory.
 *   - delete  — removed memory; title/cluster from the last known snapshot.
 *   - read    — load_memory touched it. Weakest; never masks a hotter kind.
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
  at: number; // ms epoch when the entry finalized
  seq: number; // monotone delivery cursor (#234); assigned on finalize
  count: number; // events coalesced into this entry (×N), ≥ 1
  /** #217 Valenz: der Newborn soll sofort mit Emotionsfarbe glühen — die Map
   *  adoptiert ihn als echten Node, ohne auf den Graph-Reload zu warten. */
  salience?: number;
  emotion?: string;
}

const MAX_ENTRIES = 500; // ring buffer — lossless within realistic poll gaps
const DEBOUNCE_MS = 2000; // quiet window per memory id before an entry finalizes

// hotness rank for coalescing — a hotter kind seen in the window wins the entry
const KIND_RANK: Record<LiveUpdateKind, number> = { read: 0, change: 1, add: 2, delete: 3 };

interface PendingEntry {
  update: LiveUpdate; // hottest kind so far + the latest event's data
  count: number;
  timer: ReturnType<typeof setTimeout>;
}

export function createLiveUpdates(
  vault: Vault,
  opts: { debounceMs?: number; maxEntries?: number } = {},
): {
  handleUiUpdates: (req: IncomingMessage, res: ServerResponse, settingsPath?: string) => Promise<void>;
  notifyRead: (id: string) => void;
  stop: () => void;
} {
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  const maxEntries = opts.maxEntries ?? MAX_ENTRIES;

  const recent: LiveUpdate[] = []; // finalized entries, ascending seq
  const pending = new Map<string, PendingEntry>();
  let seq = 0;

  const baseFields = (m: Memory, kind: LiveUpdateKind): LiveUpdate => ({
    id: m.fm.id,
    kind,
    title: m.fm.title,
    type: m.fm.type,
    scope: m.fm.scope,
    cluster: clusterKeyFor(m, vault.root),
    summary: m.fm.summary,
    at: Date.now(),
    seq: 0, // assigned on finalize
    count: 1, // accumulated on finalize
    ...(typeof m.fm.salience === "number" ? { salience: m.fm.salience } : {}),
    ...(m.fm.emotion ? { emotion: m.fm.emotion } : {}),
  });

  const finalize = (id: string): void => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    recent.push({ ...p.update, seq: ++seq, count: p.count });
    if (recent.length > maxEntries) recent.splice(0, recent.length - maxEntries);
  };

  // Collapse an event into the pending entry for its id (or open one) and
  // (re)arm the quiet-window timer. Nothing is delivered until the window
  // elapses — that is what turns a burst into one finalized entry.
  const ingest = (next: LiveUpdate): void => {
    const cur = pending.get(next.id);
    if (cur) {
      clearTimeout(cur.timer);
      // keep the hotter kind (newborn stays "add" through its enrich burst; a
      // delete always wins), take the rest of the data from the latest event
      const kind = KIND_RANK[next.kind] >= KIND_RANK[cur.update.kind] ? next.kind : cur.update.kind;
      cur.update = { ...next, kind };
      cur.count += 1;
      cur.timer = setTimeout(() => finalize(next.id), debounceMs);
    } else {
      pending.set(next.id, {
        update: next,
        count: 1,
        timer: setTimeout(() => finalize(next.id), debounceMs),
      });
    }
  };

  const unsubscribe = vault.on((e) => {
    if (e.kind === "add") ingest(baseFields(e.memory, "add"));
    else if (e.kind === "change") ingest(baseFields(e.memory, "change"));
    else if (e.kind === "remove") {
      // das File ist weg — Titel/Cluster aus dem letzten bekannten Snapshot
      // (noch pending, sonst der jüngste finalisierte Eintrag der id)
      let prior = pending.get(e.id)?.update;
      for (let i = recent.length - 1; !prior && i >= 0; i--) {
        if (recent[i].id === e.id) prior = recent[i];
      }
      ingest({
        id: e.id,
        kind: "delete",
        title: prior?.title ?? e.id,
        type: prior?.type ?? "memory",
        scope: prior?.scope ?? "",
        cluster: prior?.cluster ?? "",
        summary: prior?.summary ?? "",
        at: Date.now(),
        seq: 0,
        count: 1,
      });
    }
  });

  /** "read"-Notice vom load_memory-Pfad (via Telemetry-Hook, best-effort). */
  const notifyRead = (id: string): void => {
    try {
      const m = vault.get(id);
      if (m) ingest(baseFields(m, "read"));
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
    const sinceRaw = u.searchParams.get("since");
    const minSeq = recent.length > 0 ? recent[0].seq : seq;
    if (sinceRaw === null) {
      // no cursor yet → baseline the client to the high-water mark without
      // replaying history (matches the old "only events after opening" contract)
      sendJsonPlain(res, 200, { updates: [], seq, minSeq });
      return;
    }
    const since = Number(sinceRaw) || 0;
    const updates = recent.filter((e) => e.seq > since);
    sendJsonPlain(res, 200, { updates, seq, minSeq });
  }

  const stop = (): void => {
    unsubscribe();
    for (const p of pending.values()) clearTimeout(p.timer);
    pending.clear();
  };

  return { handleUiUpdates, notifyRead, stop };
}
