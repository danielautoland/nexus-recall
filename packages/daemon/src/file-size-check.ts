/**
 * Deterministischer Dateigrößen-Check im PreToolUse-Hook (Daniel, 19.07.2026).
 *
 * Die Datei-Größen-Konvention (~500 Zeilen Richtwert, >800 kritisch; Tests
 * 700/1000) hing bisher daran, dass der Agent im Schreibmoment an sie DENKT —
 * und genau da verliert sie gegen den Feature-Fokus (zweimal passiert am
 * 19.07.: orbit-view 678→959, app.js →915, ohne Hinweis). Ein Memory löst das
 * nicht: probabilistischer Abruf erzwingt keine deterministische Regel.
 *
 * Darum misst der Hook selbst: vor jedem Write/Edit auf eine Code-Datei wird
 * die aktuelle Zeilenzahl gezählt und ab Richtwert-Nähe als kompakter
 * `<file-size-check>`-Block injiziert — der Agent bekommt die Zahl
 * hingehalten, statt sich erinnern zu müssen. Pure stdlib, budget-sicher,
 * Kill-Switch BASTRA_SIZE_CHECK=off.
 *
 * Wichtig (Daniels Klarstellung): 500 ist RICHTWERT, kein Limit — 670/700
 * sind okay, wenn die Größe kohärent begründet ist. Der Block fordert deshalb
 * einen Split-VORSCHLAG vor spürbarem Wachstum, nie ein Auto-Split.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

const CODE_EXTS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
  ".py", ".swift", ".rs", ".go", ".css", ".scss", ".vue", ".svelte",
]);
/** Generated blobs / bundles are none of the convention's business. */
const MAX_BYTES = 2 * 1024 * 1024;

export interface SizeThresholds {
  guide: number;
  critical: number;
}

/** Convention thresholds for a path, or null when the file type is exempt
 *  (docs, configs, lockfiles, generated code — anything non-code).
 *  Guide value resolves env > cli-settings (size.guide — written by the
 *  onboarding interview / `bastra config set size.guide N`) > built-in 500.
 *  `settings` is the pre-read settings size block (see readSizeSettings). */
export function thresholdsFor(
  filePath: string,
  settings: { guide?: number; critical?: number } = {},
): SizeThresholds | null {
  const ext = extname(filePath).toLowerCase();
  if (!CODE_EXTS.has(ext)) return null;
  const base = basename(filePath).toLowerCase();
  const isTest = /\.(test|spec)\./.test(base) || filePath.includes("__tests__");
  if (isTest) return { guide: 700, critical: 1000 }; // test files keep the fixed convention
  const guide = envNum("BASTRA_SIZE_GUIDE", numOr(settings.guide, 500));
  const critical = Math.max(guide, envNum("BASTRA_SIZE_CRITICAL", numOr(settings.critical, 800)));
  return { guide, critical };
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 100 && v <= 5000 ? Math.round(v) : fallback;
}

function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : fallback;
}

/** Der User-Richtwert aus ~/.bastra/cli-settings.json — bewusst ein eigener
 *  Mini-Read (pure stdlib) statt settings.ts-Import: der Hook hat 250 ms
 *  Budget und braucht exakt zwei Zahlen. Fehler → leeres Objekt. */
export async function readSizeSettings(
  settingsPath: string = join(homedir(), ".bastra", "cli-settings.json"),
): Promise<{ guide?: number; critical?: number }> {
  try {
    const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as {
      size?: { guide?: unknown; critical?: unknown };
    };
    return {
      ...(typeof parsed.size?.guide === "number" ? { guide: parsed.size.guide } : {}),
      ...(typeof parsed.size?.critical === "number" ? { critical: parsed.size.critical } : {}),
    };
  } catch {
    return {};
  }
}

/** The injected note, or null while the file is comfortably under the guide.
 *  Fires from ~90 % of the guide value so the split proposal can happen
 *  BEFORE the write that crosses the line. */
export function formatSizeNote(filePath: string, lines: number, t: SizeThresholds): string | null {
  if (lines < Math.floor(t.guide * 0.9)) return null;
  const level = lines > t.critical ? "critical" : "guide";
  const msg =
    level === "critical"
      ? `over the ${t.critical}-line ceiling — do NOT grow this file further; propose a coherent module split FIRST (file-size convention: cut responsibilities, not line counts).`
      : `at/near the ~${t.guide}-line guide value — if this edit adds noticeable growth, propose a module split BEFORE writing (file-size convention; a justified ${t.guide + 200}-line file is fine, silent growth is not).`;
  return `<file-size-check file="${basename(filePath)}" lines="${lines}" level="${level}">${msg}</file-size-check>`;
}

/** Measure + format in one step — the hook's entry point. Never throws:
 *  a new/unreadable file simply has nothing to warn about. */
export async function fileSizeNote(filePath: string, settingsPath?: string): Promise<string | null> {
  if ((process.env.BASTRA_SIZE_CHECK ?? "").toLowerCase() === "off") return null;
  const t = thresholdsFor(filePath, await readSizeSettings(settingsPath));
  if (!t) return null;
  try {
    const raw = await readFile(filePath, "utf8");
    if (raw.length > MAX_BYTES) return null;
    return formatSizeNote(filePath, raw.split("\n").length, t);
  } catch {
    return null;
  }
}
