/**
 * `bastra config get|set <key> [value]` — minimal settings access from the CLI.
 *
 * Deliberately tiny: the only key today is `update.mode`. The store is the
 * OSS-owned ~/.bastra/cli-settings.json (never the Pro-app's config.json).
 * Browsing/editing memories stays in the Pro app — this is flags only.
 */
import {
  DEFAULT_UPDATE_MODE,
  UPDATE_MODES,
  getUpdateMode,
  setUpdateMode,
  settingsFilePath,
  type UpdateMode,
} from "../settings.js";
import type { ParsedArgs } from "./types.js";

const KNOWN_KEYS = ["update.mode"] as const;

export async function cmdConfig(args: ParsedArgs): Promise<number> {
  // positional: ["config", action, key, value?]
  const action = args.positional[1] ?? null;
  const key = args.positional[2] ?? null;
  const value = args.positional[3] ?? null;

  if (action !== "get" && action !== "set") {
    process.stderr.write("usage: bastra config get <key> | bastra config set <key> <value>\n");
    process.stderr.write(`known keys: ${KNOWN_KEYS.join(", ")}\n`);
    return 2;
  }

  if (key !== "update.mode") {
    process.stderr.write(`error: unknown config key '${key ?? ""}'\n`);
    process.stderr.write(`known keys: ${KNOWN_KEYS.join(", ")}\n`);
    return 2;
  }

  if (action === "get") {
    process.stdout.write(`${await getUpdateMode()}\n`);
    return 0;
  }

  // set
  if (value === null || !(UPDATE_MODES as readonly string[]).includes(value)) {
    process.stderr.write(
      `error: update.mode must be one of: ${UPDATE_MODES.join(" | ")} (default: ${DEFAULT_UPDATE_MODE})\n`,
    );
    return 2;
  }
  await setUpdateMode(value as UpdateMode);
  process.stdout.write(`✓ update.mode = ${value}\n`);
  process.stdout.write(`  stored in ${settingsFilePath()}\n`);
  if (value === "auto") {
    process.stdout.write("  bastra will now stage updates at session start (no restart mid-session).\n");
  }
  return 0;
}
