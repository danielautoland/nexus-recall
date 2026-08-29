/**
 * Hook-surface normalization (#15).
 *
 * Claude Code and Codex now feed the same daemon-side recall lanes. Codex
 * registrations set BASTRA_HOOK_CLIENT=codex; the thin clients copy that
 * value into the payload because the long-running daemon does not inherit a
 * hook process' environment. Current Codex payload markers remain a fallback
 * so hand-written hook registrations still get the right telemetry and frame.
 */

export type HookClient = "claude-code" | "codex";

export function hookClient(payload: unknown): HookClient {
  if (!payload || typeof payload !== "object") return "claude-code";
  const p = payload as Record<string, unknown>;
  if (p.bastra_client === "codex" || p.turn_id !== undefined) return "codex";
  if (typeof p.model === "string" && p.model.length > 0) return "codex";
  if (p.tool_name === "apply_patch" || p.tool_name === "update_plan") return "codex";
  return "claude-code";
}

/** Add the registration-owned client marker without mutating stdin data. */
export function decorateHookPayload<T>(payload: T): T {
  const requested = process.env.BASTRA_HOOK_CLIENT;
  if (requested !== "codex" && requested !== "claude-code") return payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  return { ...(payload as Record<string, unknown>), bastra_client: requested } as T;
}
