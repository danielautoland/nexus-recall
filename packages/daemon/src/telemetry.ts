import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type TelemetryEvent =
  | RecallEvent
  | LoadMemoryEvent
  | SaveMemoryEvent;

interface BaseEvent {
  ts: string;
  session_id: string;
}

export interface RecallEvent extends BaseEvent {
  kind: "recall";
  recall_id: string;
  query: string;
  k: number | null;
  scope: string | null;
  type: string | null;
  vault_size: number;
  hit_count: number;
  top_score: number | null;
  hits: { id: string; score: number; type: string }[];
  latency_ms: number;
}

export interface LoadMemoryEvent extends BaseEvent {
  kind: "load_memory";
  id: string;
  found: boolean;
  follows_recall: string | null;
}

export interface SaveMemoryEvent extends BaseEvent {
  kind: "save_memory";
  id: string;
  type: string;
  scope: string;
  title: string;
  tag_count: number;
  recall_when_count: number;
  body_chars: number;
  overwrite: boolean;
  created: boolean;
  follows_recall: string | null;
}

const RECALL_FOLLOWUP_WINDOW_MS = 5 * 60 * 1000;

export class Telemetry {
  private readonly enabled: boolean;
  private readonly logDir: string;
  private readonly sessionId: string;
  private lastRecall: { id: string; ts: number } | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.enabled =
      (process.env.NEXUS_TELEMETRY ?? "on").toLowerCase() !== "off";
    this.logDir =
      process.env.NEXUS_LOG_PATH ?? join(homedir(), ".nexus-recall", "logs");
    this.sessionId = randomUUID();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  newRecallId(): string {
    const id = randomUUID();
    this.lastRecall = { id, ts: Date.now() };
    return id;
  }

  /** Returns the most recent recall_id if it's still within the follow-up window. */
  recentRecallId(): string | null {
    if (!this.lastRecall) return null;
    if (Date.now() - this.lastRecall.ts > RECALL_FOLLOWUP_WINDOW_MS) return null;
    return this.lastRecall.id;
  }

  async logRecall(payload: Omit<RecallEvent, "kind" | "ts" | "session_id">): Promise<void> {
    if (!this.enabled) return;
    await this.write({
      kind: "recall",
      ts: new Date().toISOString(),
      session_id: this.sessionId,
      ...payload,
    });
  }

  async logLoadMemory(
    payload: Omit<LoadMemoryEvent, "kind" | "ts" | "session_id">,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.write({
      kind: "load_memory",
      ts: new Date().toISOString(),
      session_id: this.sessionId,
      ...payload,
    });
  }

  async logSaveMemory(
    payload: Omit<SaveMemoryEvent, "kind" | "ts" | "session_id">,
  ): Promise<void> {
    if (!this.enabled) return;
    await this.write({
      kind: "save_memory",
      ts: new Date().toISOString(),
      session_id: this.sessionId,
      ...payload,
    });
  }

  private async ensureDir(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = mkdir(this.logDir, { recursive: true }).then(() => undefined);
    }
    await this.initPromise;
  }

  private async write(event: TelemetryEvent): Promise<void> {
    try {
      await this.ensureDir();
      const day = event.ts.slice(0, 10);
      const file = join(this.logDir, `events-${day}.jsonl`);
      await appendFile(file, JSON.stringify(event) + "\n", "utf8");
    } catch (err) {
      // Telemetry must never break a tool call.
      console.error(`[nexus-recall] telemetry write failed: ${(err as Error).message}`);
    }
  }
}

export function fireAndForget(p: Promise<unknown>): void {
  p.catch((err) => {
    console.error(`[nexus-recall] telemetry: ${(err as Error).message}`);
  });
}

export function logDirFor(): string {
  return process.env.NEXUS_LOG_PATH ?? join(homedir(), ".nexus-recall", "logs");
}

// Re-export so consumers can build paths if needed.
export { dirname };
