#!/usr/bin/env node
/**
 * nexus-recall bridge — line-JSON RPC over stdio.
 *
 * Designed to be spawned as a child process by the Mac-app's Tauri
 * backend. The MCP server (index.ts) is for Claude Code; this bridge
 * is for the app's UI. Same vault, same in-memory index, different
 * transport.
 *
 * Protocol (one JSON object per line, both directions):
 *   request:  {"id": <number>, "method": <string>, "params"?: <object>}
 *   response: {"id": <number>, "result": <any>}  OR
 *             {"id": <number>, "error": {"message": <string>}}
 *
 * Methods:
 *   vault_status()                       -> { size: number }
 *   recall({ query, k?, scope?, type? }) -> RecallHit[]
 *   load_memory({ id })                  -> { id, frontmatter, body, file_path } | null
 *   save_memory(SaveMemoryInput)         -> { id, file_path, created }
 */
import { Vault, SearchIndex, saveMemory, SaveMemoryInput } from "@nexus-recall/core";
import readline from "node:readline";

const VAULT_PATH = process.env.NEXUS_VAULT_PATH;
if (!VAULT_PATH) {
  process.stderr.write("[bridge] FATAL: NEXUS_VAULT_PATH is not set\n");
  process.exit(2);
}

interface Request {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

function send(payload: object): void {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

async function main(): Promise<void> {
  const vault = new Vault(VAULT_PATH!);
  const { loaded, skipped } = await vault.init();
  process.stderr.write(
    `[bridge] vault loaded: ${loaded} memorys` +
      (skipped.length ? `, ${skipped.length} skipped` : "") +
      "\n",
  );
  vault.startWatching();
  const search = new SearchIndex(vault);
  search.start();
  process.stderr.write("[bridge] ready\n");

  const rl = readline.createInterface({ input: process.stdin });

  rl.on("line", (line) => {
    let req: Request;
    try {
      req = JSON.parse(line);
    } catch {
      return; // malformed → silently drop, no id to reply to
    }
    const { id, method, params } = req;
    try {
      let result: unknown;
      switch (method) {
        case "vault_status":
          result = { size: vault.size() };
          break;
        case "recall":
          result = search.recall(String(params?.query ?? ""), {
            k: params?.k as number | undefined,
            scope: params?.scope as string | undefined,
            type: params?.type as string | undefined,
          });
          break;
        case "load_memory": {
          const m = search.loadFull(String(params?.id ?? ""));
          result = m
            ? {
                id: m.fm.id,
                frontmatter: m.fm,
                body: m.body,
                file_path: m.filePath,
              }
            : null;
          break;
        }
        case "save_memory": {
          const parsed = SaveMemoryInput.safeParse(params);
          if (!parsed.success) {
            throw new Error(parsed.error.message);
          }
          // saveMemory returns a promise — we resolve it inline below
          saveMemory(VAULT_PATH!, parsed.data)
            .then(async (saveResult) => {
              await vault.reindexFile(saveResult.file_path);
              send({ id, result: saveResult });
            })
            .catch((err: Error) => {
              send({ id, error: { message: err.message } });
            });
          return; // async branch handles its own send()
        }
        default:
          throw new Error(`unknown method: ${method}`);
      }
      send({ id, result });
    } catch (err) {
      send({
        id,
        error: { message: err instanceof Error ? err.message : String(err) },
      });
    }
  });

  rl.on("close", () => {
    process.stderr.write("[bridge] stdin closed, exiting\n");
    process.exit(0);
  });
}

main().catch((err) => {
  process.stderr.write(`[bridge] FATAL: ${err}\n`);
  process.exit(1);
});
