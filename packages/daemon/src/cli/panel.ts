/**
 * `bastra` (no args) — compact status panel.
 *
 * Shows version + update status, the configured update mode, daemon health and
 * vault size. Read-only, single shot, no TUI: this is the OSS "control surface"
 * — flags and status. Browsing/editing memories lives in the Pro Mac app.
 */
import { request as httpRequest } from "node:http";
import { VERSION } from "./helpers.js";
import { getUpdateMode } from "../settings.js";
import { envFirst } from "../env.js";
import type { ParsedArgs } from "./types.js";

interface HealthUpdate {
  current: string;
  latest: string;
  html_url: string;
}

interface HealthResponse {
  ok: boolean;
  version?: string;
  vault_size?: number;
  update_available?: HealthUpdate | null;
}

function daemonPort(): string {
  return envFirst("BASTRA_HTTP_PORT", "NEXUS_HTTP_PORT") ?? "6723";
}

function getJson<T>(url: string, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve_) => {
    const req = httpRequest(url, { method: "GET", timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          if (res.statusCode === 200) {
            resolve_(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
            return;
          }
        } catch { /* fallthrough */ }
        resolve_(null);
      });
    });
    req.on("timeout", () => { req.destroy(); resolve_(null); });
    req.on("error", () => resolve_(null));
    req.end();
  });
}

function probeHealth(port: string): Promise<HealthResponse | null> {
  return getJson<HealthResponse>(`http://127.0.0.1:${port}/health`, 1200).then(
    (d) => (d && d.ok ? d : null),
  );
}

/**
 * Fresh memory count: hits /vault/count, which reconciles the daemon's index
 * against disk first (the watcher misses external writes on cloud mounts, so
 * /health's vault_size can be stale). Bigger timeout — reconcile walks the
 * tree. Null on any failure; the panel then falls back to /health's size.
 */
function probeCount(port: string): Promise<number | null> {
  return getJson<{ count: number }>(`http://127.0.0.1:${port}/vault/count`, 4000).then(
    (d) => (d && typeof d.count === "number" ? d.count : null),
  );
}

function renderBox(title: string, rows: Array<[string, string]>): string {
  const labelWidth = Math.max(...rows.map(([l]) => l.length));
  const lines = rows.map(([l, v]) => `  ${l.padEnd(labelWidth)}  ${v}`);
  const innerWidth = Math.max(title.length + 3, ...lines.map((l) => l.length));
  const top = `┌ ${title} ${"─".repeat(Math.max(0, innerWidth - title.length - 2))}┐`;
  const bottom = `└${"─".repeat(innerWidth)}┘`;
  return [top, ...lines, bottom].join("\n");
}

export async function cmdPanel(_args: ParsedArgs): Promise<number> {
  const port = daemonPort();
  // Fresh count (reconciles index vs. disk) + health + mode, in parallel.
  const [health, freshCount, mode] = await Promise.all([
    probeHealth(port),
    probeCount(port),
    getUpdateMode(),
  ]);

  const liveVersion = health?.version ?? VERSION;
  let versionStatus: string;
  if (health?.update_available) {
    versionStatus = `↑ ${health.update_available.latest} available`;
  } else if (health) {
    versionStatus = "✓ up to date";
  } else {
    versionStatus = "(daemon offline — can't check)";
  }

  const daemonRow = health
    ? `✓ running (port ${port})`
    : "✗ not running (auto-spawns on next MCP call)";
  // Prefer the reconciled count; fall back to /health's (possibly stale) size.
  const count = freshCount ?? health?.vault_size ?? null;
  const vaultRow = count != null ? `${count} memories` : "—";

  const box = renderBox("bastra-recall", [
    ["version", `${liveVersion}  ${versionStatus}`],
    ["update", `mode: ${mode}`],
    ["daemon", daemonRow],
    ["vault", vaultRow],
  ]);

  process.stdout.write(box + "\n");
  process.stdout.write("  bastra help                       all commands\n");
  process.stdout.write("  bastra config set update.mode …   notify | auto | off\n");
  if (health?.update_available) {
    process.stdout.write(`  bastra update                     get ${health.update_available.latest} now\n`);
  }
  return 0;
}
