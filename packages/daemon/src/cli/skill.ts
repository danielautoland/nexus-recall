import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { SERVER_KEY, fileExists, getServersBlock, readJsonConfig } from "./helpers.js";
import {
  CLAUDE_CODE_CONFIG,
  CLAUDE_DESKTOP_CONFIG,
  SKILL_SOURCE_PATH,
  SKILL_TARGET_DIR,
  SKILL_TARGET_FILE,
} from "./paths.js";

export type SkillStepStatus =
  | "installed"
  | "already-installed"
  | "would-install"
  | "removed"
  | "not-present"
  | "would-remove"
  | "error";

export async function copySkill(opts: { dryRun: boolean }): Promise<{ status: SkillStepStatus; detail: string }> {
  if (!(await fileExists(SKILL_SOURCE_PATH))) {
    return { status: "error", detail: `skill source missing: ${SKILL_SOURCE_PATH}` };
  }
  if (await fileExists(SKILL_TARGET_FILE)) {
    const src = await readFile(SKILL_SOURCE_PATH, "utf8");
    const dst = await readFile(SKILL_TARGET_FILE, "utf8");
    if (src === dst) return { status: "already-installed", detail: `skill already at ${SKILL_TARGET_FILE}` };
  }
  if (opts.dryRun) {
    return { status: "would-install", detail: `would copy SKILL.md → ${SKILL_TARGET_FILE}` };
  }
  await mkdir(SKILL_TARGET_DIR, { recursive: true });
  await copyFile(SKILL_SOURCE_PATH, SKILL_TARGET_FILE);
  return { status: "installed", detail: `skill installed at ${SKILL_TARGET_FILE}` };
}

// ─── post-uninstall skill sweep (#181) ───────────────────────────────────────

/** Surfaces that share the skill under ~/.claude/skills/ (Cursor doesn't). */
export const SKILL_SHARING_SURFACES = ["claude-desktop", "claude-code"] as const;

/** Skill-sharing surfaces this run must uninstall cleanly before a sweep. */
function requiredSweepSurfaces(surface: string | null): string[] {
  if (surface === "all") return [...SKILL_SHARING_SURFACES];
  return (SKILL_SHARING_SURFACES as readonly string[]).includes(surface ?? "") ? [surface as string] : [];
}

/**
 * Pure guard for the final sweep after the uninstall surface loop: sweep only
 * when this run targeted a skill-sharing surface (or 'all') AND no surface
 * registration still references the skill. A remaining registration always
 * wins; runs that never touch ~/.claude/skills (cursor) never sweep.
 * `succeededSurfaces` (when given) lists the surfaces whose uninstall
 * reported removed/would-remove/not-present — a covered surface missing from
 * it FAILED and counts as still registered, so a failed uninstall never
 * triggers (or dry-run-promises) the sweep.
 */
export function shouldSweepSkill(i: {
  surface: string | null;
  remainingRegistrations: string[];
  succeededSurfaces?: string[];
}): boolean {
  const covers =
    i.surface === "all" || (SKILL_SHARING_SURFACES as readonly string[]).includes(i.surface ?? "");
  if (!covers || i.remainingRegistrations.length > 0) return false;
  if (i.succeededSurfaces === undefined) return true;
  const succeeded = i.succeededSurfaces;
  return requiredSweepSurfaces(i.surface).every((s) => succeeded.includes(s));
}

/**
 * Skill-sharing surfaces whose config still registers the MCP server.
 * An unreadable/invalid config counts as registered — never delete on
 * uncertainty.
 */
async function liveSkillRegistrations(configPaths: Record<string, string>): Promise<string[]> {
  const registered: string[] = [];
  for (const [surface, path] of Object.entries(configPaths)) {
    const read = await readJsonConfig(path);
    if ("error" in read) {
      registered.push(surface);
      continue;
    }
    const servers = getServersBlock(read.data);
    if (servers && SERVER_KEY in servers) registered.push(surface);
  }
  return registered;
}

/**
 * Final sweep after the uninstall surface loop (#181): per-surface uninstalls
 * keep the shared skill, so a full run used to leave ~/.claude/skills/
 * bastra-recall behind. Registrations are read live AFTER the loop — a failed
 * surface uninstall keeps its registration and blocks the sweep. Under
 * --dry-run nothing was removed yet, so surfaces covered by this run are
 * subtracted instead — but only those whose uninstall reported
 * removed/would-remove/not-present (`succeededSurfaces`): a surface that
 * ERRORED counts as still registered. Best-effort: never throws; missing
 * dir = not-present. `io` is injectable for tests only (real paths live
 * under HOME).
 */
export async function sweepSharedSkill(
  opts: { surface: string | null; dryRun: boolean; succeededSurfaces?: string[] },
  io: { skillDir?: string; configPaths?: Record<string, string> } = {},
): Promise<{ status: "removed" | "would-remove" | "kept" | "not-present"; detail: string }> {
  try {
    const skillDir = io.skillDir ?? SKILL_TARGET_DIR;
    if (!(await fileExists(skillDir))) return { status: "not-present", detail: `no skill at ${skillDir}` };
    const configPaths = io.configPaths ?? {
      "claude-desktop": CLAUDE_DESKTOP_CONFIG,
      "claude-code": CLAUDE_CODE_CONFIG,
    };
    const succeeded = (s: string) =>
      opts.succeededSurfaces === undefined || opts.succeededSurfaces.includes(s);
    const coveredByRun = (s: string) => opts.surface === "all" || s === opts.surface;
    const live = await liveSkillRegistrations(configPaths);
    const remaining = opts.dryRun
      ? live.filter((s) => !coveredByRun(s) || !succeeded(s))
      : live;
    if (!shouldSweepSkill({
      surface: opts.surface,
      remainingRegistrations: remaining,
      succeededSurfaces: opts.succeededSurfaces,
    })) {
      const failed = requiredSweepSurfaces(opts.surface).filter((s) => !succeeded(s));
      const why = [
        remaining.length > 0 ? `still registered: ${remaining.join(", ")}` : "",
        failed.length > 0 ? `uninstall failed: ${failed.join(", ")}` : "",
      ].filter(Boolean).join("; ") || "still registered: none";
      return { status: "kept", detail: `kept (${why})` };
    }
    if (opts.dryRun) {
      return { status: "would-remove", detail: `${skillDir} — no surface registration would remain` };
    }
    await rm(skillDir, { recursive: true, force: true });
    return { status: "removed", detail: `${skillDir} — no surface registration references it anymore` };
  } catch (err) {
    // Cleanup must never fail the uninstall — an unregistered skill is inert.
    return { status: "kept", detail: `kept (${(err as Error).message})` };
  }
}
