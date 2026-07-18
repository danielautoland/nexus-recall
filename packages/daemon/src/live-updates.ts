/**
 * Live updates (#216) — a small ring buffer of freshly saved memories, fed
 * by the vault watcher, polled by the map (`GET /ui/updates?since=<ms>`).
 * The universe view turns each entry into a supernova with a preview card.
 *
 * Deliberately a poll, not a push: one tiny JSON answer every few seconds
 * beats a standing event-stream connection for exactly one consumer, and
 * the buffer is bounded so an import burst can't grow memory.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { clusterKeyFor, type Memory, type Vault } from "@bastra-recall/core";
import { sendJsonPlain } from "./webui.js";
import { getUiEnabled } from "./settings.js";

export interface LiveUpdate {
  id: string;
  title: string;
  type: string;
  scope: string;
  cluster: string;
  summary: string;
  at: number; // ms epoch when the daemon saw the file
}

const MAX_ENTRIES = 50;
const MAX_AGE_MS = 10 * 60 * 1000; // entries older than this stop being served

export function createLiveUpdates(vault: Vault): {
  handleUiUpdates: (req: IncomingMessage, res: ServerResponse, settingsPath?: string) => Promise<void>;
  stop: () => void;
} {
  const recent: LiveUpdate[] = [];

  const push = (m: Memory): void => {
    // an overwrite of an already-listed id refreshes its entry instead of
    // stacking duplicates (save → enrich → reindex fires several events)
    const existing = recent.findIndex((e) => e.id === m.fm.id);
    if (existing >= 0) recent.splice(existing, 1);
    recent.push({
      id: m.fm.id,
      title: m.fm.title,
      type: m.fm.type,
      scope: m.fm.scope,
      cluster: clusterKeyFor(m, vault.root),
      summary: m.fm.summary,
      at: Date.now(),
    });
    if (recent.length > MAX_ENTRIES) recent.splice(0, recent.length - MAX_ENTRIES);
  };

  const unsubscribe = vault.on((e) => {
    if (e.kind === "add") push(e.memory);
  });

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

  return { handleUiUpdates, stop: unsubscribe };
}
