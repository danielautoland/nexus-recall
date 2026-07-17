/**
 * `bastra map` (alias: `bastra ui`) — the discovery path to the vault map
 * (#207). Prints the local URL and opens it in the default browser; when the
 * map is still disabled it offers to enable it right there (the daemon reads
 * ui.enabled per request, so no restart is needed).
 */
import { spawn } from "node:child_process";
import { getUiEnabled, setUiEnabled } from "../settings.js";
import { probeDaemon } from "./helpers.js";
import { confirm, isInteractive } from "./prompt.js";

/** The map's URL on this machine — same port resolution as the daemon. */
export function mapUrl(): string {
  const port = Number(process.env.BASTRA_HTTP_PORT ?? process.env.NEXUS_HTTP_PORT ?? "") || 6723;
  return `http://127.0.0.1:${port}/ui`;
}

export function openInBrowser(url: string): void {
  const [cmd, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}

export async function cmdMap(): Promise<number> {
  const url = mapUrl();
  if (!(await getUiEnabled())) {
    if (!isInteractive()) {
      process.stderr.write(`vault map is disabled — enable it: bastra config set ui.enabled true\n`);
      return 1;
    }
    const yes = await confirm("The vault map is disabled. Enable it now? (local only, no restart needed)", {
      defaultYes: true,
    });
    if (!yes) {
      process.stdout.write("Kept off — enable later: bastra config set ui.enabled true\n");
      return 0;
    }
    await setUiEnabled(true);
    process.stdout.write("✓ ui.enabled = true\n");
  }
  const probe = await probeDaemon();
  if (!probe.ok) {
    process.stdout.write("· daemon not reachable yet — it starts with your next AI session; reload the page then\n");
  }
  process.stdout.write(`vault map: ${url}\n`);
  openInBrowser(url);
  return 0;
}
