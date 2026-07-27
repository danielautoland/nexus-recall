/**
 * #206 — audit coverage for the paths the agent actually writes through.
 *
 * The append-only audit log already exists (`packages/core/src/audit-log.ts`,
 * `<vault>/.bastra/audit-log.ndjson`) and `auditedSave`/`auditedSoftDelete`
 * wrap it. But they were wired into exactly one caller: the Mac-app bridge.
 * Every write that arrives over MCP or REST — which is how the assistant
 * writes — went past it, so the one surface that is supposed to run
 * autonomously was the one with no trail.
 *
 * Telemetry is not a substitute: it can be switched off (`telemetry.ts`) and
 * it is pruned after 90 days (`log-retention.ts`). The audit log is neither.
 *
 * ## Why this records directly instead of converting callers to `auditedSave`
 *
 * `auditedSave` does more than record: it re-derives the id, snapshots
 * `diff_before`, and throws when an `assistant` mutation carries no `reason`.
 * The MCP save path has re-file and trash handling wrapped around its write,
 * and the tool schema has no `reason` field — routing it through `auditedSave`
 * would either break every agent save or force a fabricated reason into the
 * log. A missing reason is honest; an invented one is worse than none.
 *
 * So this module is deliberately thin: it records what happened, next to the
 * write, and never changes whether the write succeeds. Converting the call
 * sites properly (and giving `save_memory` a real `reason`) is a separate step.
 *
 * ## Failure policy
 *
 * An audit failure must never cost the user their write. Recording is
 * best-effort and reports to stderr; the write has already landed by then.
 * That is a deliberate trade: this log is for reconstructing what happened,
 * not a transaction gate.
 */
import { AuditLog, type AuditActor, type AuditOperation } from "@bastra-recall/core";

/** One AuditLog per vault — it caches reads, and re-creating it per write
 *  would throw that cache away on every save. */
const logs = new Map<string, AuditLog>();

function logFor(vaultRoot: string): AuditLog {
  let log = logs.get(vaultRoot);
  if (!log) {
    log = new AuditLog(vaultRoot);
    logs.set(vaultRoot, log);
  }
  return log;
}

export interface AuditTrailInput {
  vaultRoot: string;
  memoryId: string;
  operation: AuditOperation;
  /** Who caused it. MCP/REST writes are `assistant`; the CLI onboarding flow
   *  is `user`, because a human answered the questions. */
  actor: AuditActor;
  /** Which surface — `mcp:save_memory`, `http:save_document`, … . This is what
   *  makes the log answer "through which run did this change?". */
  actorDetail: string;
  diffBefore: Record<string, unknown> | null;
  diffAfter: Record<string, unknown> | null;
  filePath?: string;
  /** Absent on the MCP path: the tool schema has no reason field, and a
   *  generated one would be noise dressed as provenance. */
  reason?: string;
  sessionId?: string;
}

/**
 * Append one entry. Never throws — a broken audit log must not turn a
 * successful save into a failed tool call.
 */
export async function recordAudit(input: AuditTrailInput): Promise<void> {
  try {
    await logFor(input.vaultRoot).record({
      memory_id: input.memoryId,
      actor: input.actor,
      actor_detail: input.actorDetail,
      operation: input.operation,
      diff_before: input.diffBefore,
      diff_after: input.diffAfter,
      ...(input.filePath ? { file_path: input.filePath } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
    });
  } catch (err) {
    console.error(
      `[bastra-recall] audit: could not record ${input.operation} of ${input.memoryId}: ${(err as Error).message}`,
    );
  }
}

/** Test seam — the module-level cache would otherwise leak between vaults. */
export function resetAuditLogCache(): void {
  logs.clear();
}
