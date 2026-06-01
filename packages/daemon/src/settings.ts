/**
 * bastra-recall local CLI settings (#39 follow-up: auto-update).
 *
 * A small, OSS-owned settings file at ~/.bastra/cli-settings.json — deliberately
 * separate from ~/.bastra/config.json, which is owned by the Pro Mac-app and its
 * onboarding flow. We never touch that file; this one is ours.
 *
 * Currently only carries the update mode:
 *   - "notify" (default): detect + dim CLI hint + SessionStart <bastra-update> block.
 *   - "auto":             same detection, plus a detached staged update at session start.
 *   - "off":              no detection, no hint, no block, no auto.
 *
 * The env var BASTRA_UPDATE_CHECK=off is a hard kill-switch that wins over the
 * stored mode (see effectiveUpdateMode) — kept for backwards-compat with #39.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export type UpdateMode = "notify" | "auto" | "off";
export const UPDATE_MODES: readonly UpdateMode[] = ["notify", "auto", "off"];
export const DEFAULT_UPDATE_MODE: UpdateMode = "notify";

export interface CliSettings {
  update: { mode: UpdateMode };
}

export function settingsFilePath(): string {
  return join(homedir(), ".bastra", "cli-settings.json");
}

function isUpdateMode(v: unknown): v is UpdateMode {
  return typeof v === "string" && (UPDATE_MODES as readonly string[]).includes(v);
}

/** Reads the stored settings, falling back to defaults on any error. Never throws. */
export async function readSettings(path: string = settingsFilePath()): Promise<CliSettings> {
  try {
    const raw = await readFile(path, "utf8");
    const data = JSON.parse(raw) as { update?: { mode?: unknown } };
    const mode = isUpdateMode(data?.update?.mode) ? data.update.mode : DEFAULT_UPDATE_MODE;
    return { update: { mode } };
  } catch {
    return { update: { mode: DEFAULT_UPDATE_MODE } };
  }
}

/** The stored update mode (env-agnostic). */
export async function getUpdateMode(path?: string): Promise<UpdateMode> {
  return (await readSettings(path)).update.mode;
}

/**
 * The effective mode after applying the env kill-switch: if BASTRA_UPDATE_CHECK
 * is set to a falsy value, the mode is forced to "off" regardless of the file.
 */
export async function effectiveUpdateMode(path?: string): Promise<UpdateMode> {
  const env = (process.env.BASTRA_UPDATE_CHECK ?? "").toLowerCase();
  if (env === "off" || env === "0" || env === "false" || env === "no") return "off";
  return getUpdateMode(path);
}

/** Persists a new update mode atomically (tmp + rename), merging into existing settings. */
export async function setUpdateMode(mode: UpdateMode, path: string = settingsFilePath()): Promise<void> {
  const current = await readSettings(path);
  const next: CliSettings = { ...current, update: { ...current.update, mode } };
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}
