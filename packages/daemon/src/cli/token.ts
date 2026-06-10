/**
 * `bastra token` — print the daemon's REST API token, minting one on first use.
 *
 * Browser / REST clients (e.g. the bastra.io web app reaching the local daemon
 * over the Browser-Bridge) authenticate with this as a `Bearer` token. Together
 * with the Origin-gate + CORS-allowlist in http.ts it's what lets a hosted site
 * talk to 127.0.0.1 safely: a stray website can't guess the token and isn't on
 * the allowlist. `bastra token rotate` issues a fresh token (the old one stops
 * working). The daemon reads the token at startup, so restart it after issuing
 * or rotating — the next recall respawns it.
 *
 * stdout = the bare token (script-friendly); stderr = the human hint.
 */
import { ensureApiToken } from "../settings.js";

export async function cmdToken(args: { sub: string | null; json: boolean }): Promise<number> {
  if (args.sub && args.sub !== "rotate" && args.sub !== "show") {
    process.stderr.write(
      `error: unknown 'token' subcommand '${args.sub}' — use 'bastra token' or 'bastra token rotate'\n`,
    );
    return 2;
  }
  const rotate = args.sub === "rotate";
  const token = await ensureApiToken({ rotate });

  if (args.json) {
    process.stdout.write(JSON.stringify({ token, rotated: rotate }) + "\n");
    return 0;
  }
  process.stdout.write(token + "\n");
  process.stderr.write(
    (rotate ? "↻ rotated — the previous token no longer works.\n" : "") +
      "Paste into bastra.io → Settings → Recall, then restart the daemon so it\n" +
      "loads the token (the next recall respawns it): bastra update\n",
  );
  return 0;
}
