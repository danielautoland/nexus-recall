/**
 * Shared request/response helpers for the daemon's HTTP surface: JSON body
 * reading with a size cap, JSON/CORS response writing, SSE framing, and the
 * clamped-int parser. Imported by http.ts and its route modules.
 * Split out of http.ts (file-size convention).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export const MAX_BODY_BYTES = 256 * 1024; // 256 KiB — content excerpts are capped client-side

// ─── SSE helpers ─────────────────────────────────────────────────

export function openSseHeaders(res: ServerResponse): void {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // Disable Nagle for prompt event delivery on local connections.
  res.setHeader("X-Accel-Buffering", "no");
  res.writeHead(200);
  // First chunk forces headers to flush so curl/test clients see them
  // before the first stage event lands.
  res.write(":ok\n\n");
}

export function writeSseEvent(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ─── helpers ─────────────────────────────────────────────────────

export function sendCors(
  res: ServerResponse,
  origin: string | null,
  opts?: { allowPrivateNetwork?: boolean },
): void {
  // Nur spiegeln, wenn die Origin erlaubt ist (null = nicht erlaubt → kein
  // ACAO-Header, der Browser blockt die Response selbst). Vary: Origin, damit
  // Caches/Proxies die per-Origin-Antwort nicht über Origins hinweg vermischen.
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );
  res.setHeader("Access-Control-Max-Age", "600");
  // Private Network Access: Chrome verlangt bei einem Preflight von öffentlicher
  // HTTPS-Origin auf eine private/localhost-Ressource diesen Antwort-Header,
  // sonst blockt es den Call. Wird nur beim OPTIONS-Preflight gesetzt (Caller
  // entscheidet) und nur bei erlaubter Origin — konsistent mit dem ACAO-Header.
  if (opts?.allowPrivateNetwork && origin) {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  if (!res.headersSent) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(payload).toString());
  }
  res.writeHead(status);
  res.end(payload);
}

export function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`body too large (>${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        resolve(parsed);
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", (err) => reject(err));
  });
}

export function clampInt(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const i = Math.round(raw);
  return Math.min(max, Math.max(min, i));
}
