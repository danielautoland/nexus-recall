#!/usr/bin/env node
/**
 * nexus-recall daemon — MCP server over a markdown memory vault.
 *
 * Tools exposed:
 *   recall(query, k?, scope?, type?)  → top-k matches
 *   load_memory(id)                   → full memory content (frontmatter + body)
 *
 * Configuration (env):
 *   NEXUS_VAULT_PATH  — required. Absolute path to the vault directory
 *                       (e.g. /Users/n0mad/Daniel/memorys).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { Vault } from "./vault.js";
import { SearchIndex } from "./search.js";

const VAULT_PATH = process.env.NEXUS_VAULT_PATH;
if (!VAULT_PATH) {
  console.error(
    "[nexus-recall] FATAL: NEXUS_VAULT_PATH is not set. " +
      "Point it at the directory holding your memory .md files.",
  );
  process.exit(2);
}

const RecallArgs = z.object({
  query: z.string().min(1),
  k: z.number().int().min(1).max(20).optional(),
  scope: z.string().optional(),
  type: z.string().optional(),
});

const LoadMemoryArgs = z.object({
  id: z.string().min(1),
});

async function main(): Promise<void> {
  const vault = new Vault(VAULT_PATH!);
  const { loaded, skipped } = await vault.init();
  console.error(
    `[nexus-recall] vault loaded: ${loaded} memorys` +
      (skipped.length ? `, ${skipped.length} skipped` : ""),
  );
  for (const s of skipped) {
    console.error(`[nexus-recall]   skipped ${s.path}: ${s.err}`);
  }
  vault.startWatching();

  const search = new SearchIndex(vault);
  search.start();

  const server = new Server(
    { name: "nexus-recall", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      {
        name: "recall",
        description:
          "Search the memory vault. Returns the top-k matching memorys " +
          "(id, title, type, scope, summary, score). Always call this " +
          "BEFORE acting when the user's prompt or your intended action " +
          "touches a topic that might have a relevant lesson, preference, " +
          "decision, or project-fact stored.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Natural-language query OR a description of what you are " +
                "about to do (e.g. 'creating new input component', " +
                "'about to give a multi-option plan').",
            },
            k: {
              type: "number",
              description: "Max results (default 5, range 1-20).",
            },
            scope: {
              type: "string",
              description:
                "Optional exact-match filter, e.g. 'carnexus', " +
                "'user-preference', 'all-projects'.",
            },
            type: {
              type: "string",
              description:
                "Optional exact-match filter on memory type, e.g. 'lesson', " +
                "'preference', 'project-fact'.",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "load_memory",
        description:
          "Load the full content (frontmatter + body) of a single memory " +
          "by id. Use this after recall() returns a hint with a high score, " +
          "to read the full lesson before acting.",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Memory id (the slug, no .md extension).",
            },
          },
          required: ["id"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;

    if (name === "recall") {
      const parsed = RecallArgs.safeParse(args);
      if (!parsed.success) return errorResult(parsed.error.message);
      const hits = search.recall(parsed.data.query, {
        k: parsed.data.k,
        scope: parsed.data.scope,
        type: parsed.data.type,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                query: parsed.data.query,
                vault_size: vault.size(),
                hits,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (name === "load_memory") {
      const parsed = LoadMemoryArgs.safeParse(args);
      if (!parsed.success) return errorResult(parsed.error.message);
      const m = search.loadFull(parsed.data.id);
      if (!m) return errorResult(`memory not found: ${parsed.data.id}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: m.fm.id,
                frontmatter: m.fm,
                body: m.body,
                file_path: m.filePath,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    return errorResult(`unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[nexus-recall] MCP server ready on stdio`);

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.error("[nexus-recall] shutting down");
    search.stop();
    await vault.stop();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

function errorResult(msg: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: msg }],
  };
}

main().catch((err) => {
  console.error("[nexus-recall] FATAL:", err);
  process.exit(1);
});
