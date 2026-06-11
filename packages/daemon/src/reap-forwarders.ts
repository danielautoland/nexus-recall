/**
 * Zombie-Forwarder-Reaping für den Claude-Desktop-Spawn-Shape (#80).
 *
 * Claude Code spawnt den mcp-forwarder direkt → stirbt CC hart, wird der
 * Forwarder zu init/launchd reparented und der ppid===1-Backstop (#49)
 * greift. Claude Desktop spawnt ihn aber durch einen Wrapper:
 *
 *   Claude.app → …/Helpers/disclaimer → node …/mcp-forwarder.js
 *
 * Stirbt Desktop, lebt der disclaimer-Wrapper weiter (er wartet auf sein
 * Kind) — der Forwarder behält ppid=disclaimer ≠ 1 und sein stdin bleibt
 * offen, weil der Wrapper die Pipes hält. Ergebnis: tagelange Zombies.
 *
 * Erkennung ohne PID-Reuse-Risiko: stirbt Desktop, wird der WRAPPER zu
 * init/launchd reparented → `ppid(wrapper) === 1`. Das prüfen sowohl der
 * Forwarder selbst (Poll, siehe mcp-forwarder.ts) als auch der Daemon beim
 * Boot (Sweep über die Prozesstabelle).
 */
import { spawnSync } from "node:child_process";

export interface ProcRow {
  pid: number;
  ppid: number;
  command: string;
}

/** `ps -axo pid=,ppid=,command=` output → rows. Exported for unit tests. */
export function parsePsTable(out: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] });
  }
  return rows;
}

/**
 * Forwarder-PIDs, deren Client tot ist. Stale heißt:
 *  - ppid === 1 (klassischer Orphan — der eigene Backstop killt ihn binnen
 *    30 s, der Daemon-Sweep räumt nur schneller auf), oder
 *  - Parent ist ein Wrapper (disclaimer) der selbst zu init reparented wurde
 *    → der spawnen­de Client (Claude Desktop) existiert nicht mehr.
 * Lebende Setups matchen nie: bei aktivem Desktop hat der disclaimer
 * ppid = Desktop-PID ≠ 1; bei Claude Code ist der Parent kein Wrapper.
 * Exported for unit tests.
 */
export function findStaleForwarders(rows: ProcRow[], selfPid: number): number[] {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const stale: number[] = [];
  for (const r of rows) {
    if (r.pid === selfPid) continue;
    if (!r.command.includes("mcp-forwarder")) continue;
    // Der disclaimer-Wrapper trägt das Forwarder-Script selbst als Argument —
    // nicht als Forwarder zählen; er stirbt von allein, wenn sein Kind geht.
    if (r.command.includes("disclaimer")) continue;
    if (r.ppid === 1) {
      stale.push(r.pid);
      continue;
    }
    const parent = byPid.get(r.ppid);
    if (parent && parent.command.includes("disclaimer") && parent.ppid === 1) {
      stale.push(r.pid);
    }
  }
  return stale;
}

/** ppid eines Prozesses via `ps`; null wenn der Prozess nicht (mehr) existiert. */
export function parentPidOf(pid: number): number | null {
  const r = spawnSync("/bin/ps", ["-o", "ppid=", "-p", String(pid)], {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  });
  if (r.status !== 0) return null;
  const n = Number(String(r.stdout).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** command-Spalte eines Prozesses via `ps`; null wenn nicht lesbar. */
export function commandOf(pid: number): string | null {
  const r = spawnSync("/bin/ps", ["-o", "command=", "-p", String(pid)], {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  });
  if (r.status !== 0) return null;
  const s = String(r.stdout).trim();
  return s.length > 0 ? s : null;
}

/**
 * Daemon-Boot-Sweep: stale Forwarder SIGTERMen (sie haben einen sauberen
 * SIGTERM-Handler; der Wrapper stirbt von selbst, sobald sein Kind weg ist).
 * Best-effort — wirft nie, loggt nur.
 */
export function reapStaleForwarderProcesses(): void {
  try {
    const r = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,command="], {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (r.status !== 0) return;
    const stale = findStaleForwarders(parsePsTable(String(r.stdout)), process.pid);
    for (const pid of stale) {
      try {
        process.kill(pid, "SIGTERM");
        console.error(`[bastra-recall] reaped stale mcp-forwarder pid=${pid} (client gone, #80)`);
      } catch {
        /* already gone */
      }
    }
  } catch (err) {
    console.error(`[bastra-recall] forwarder reap sweep failed (non-fatal): ${err}`);
  }
}
