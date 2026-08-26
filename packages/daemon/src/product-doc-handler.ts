/**
 * save_product_doc — living per-project product documentation ("software wiki").
 *
 * Writes user-facing docs into `dokumentationen/<project>/` in the vault (the
 * routing already exists in core: subfolderFor() sends type "doc" there).
 * Semantics differ from save_memory on purpose:
 *
 *   - ONE doc per feature area, stable id `doku-<project>-<area>` — calling
 *     again with the same project+area REPLACES the body (update-in-place).
 *     No overwrite flag; the whole point is a living document, not an
 *     append-only memory trail.
 *   - The body IS the product (rendered markdown a user reads), not recall
 *     fodder — quality scoring for memories does not apply here.
 *
 * Gating: the capture *instruction* is injected by the session hook only when
 * docs.mode != "off" (see settings.ts). The tool itself is always callable so
 * the user can ask for a doc update manually at any time.
 */
import { z } from "zod";
import {
  isPathSafeComponent,
  normalizeScopeKey,
  saveMemory,
  slugify,
  truncateSummaryTo,
  SUMMARY_MAX,
} from "@bastra-recall/core";
import type { ToolDeps } from "./tool-handlers.js";
import { recordAudit } from "./audit-trail.js";

export const SaveProductDocArgs = z.object({
  project: z.string().min(1).refine(isPathSafeComponent, {
    message: "project must not contain path separators, '..', or a leading dot",
  }),
  area: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string().min(1)).optional(),
  recall_when: z.array(z.string().min(1)).optional(),
});

export interface SaveProductDocResult {
  id: string;
  file_path: string;
  created: boolean;
  updated: boolean;
}

export async function saveProductDocHandler(
  deps: ToolDeps,
  rawArgs: unknown,
): Promise<SaveProductDocResult> {
  const parsed = SaveProductDocArgs.safeParse(rawArgs);
  if (!parsed.success) throw new Error(parsed.error.message);
  const { project, area, title, summary, body } = parsed.data;

  const areaSlug = slugify(area);
  if (!areaSlug) throw new Error(`area slugifies to nothing: ${JSON.stringify(area)}`);
  // #360-Folgefund D (Codex-Gegenreview): `project` kam roh vom Aufrufer und
  // wurde ungefaltet zu id, Scope, Ordner, topic_path und Tags. Ein zweiter
  // Aufruf mit anderer Schreibweise erzeugte damit eine zweite logische
  // Doku — auf case-insensitiven Dateisystemen ein stilles Überschreiben.
  // Kanonischer Key für jede IDENTITÄT, rohe Schreibweise nur in title/body.
  const projectKey = normalizeScopeKey(project);
  const id = `doku-${projectKey}-${areaSlug}`;

  const before = deps.vault.get(id);
  const existed = before !== undefined;
  const result = await saveMemory(deps.vaultPath, {
    id,
    title,
    type: "doc",
    summary: truncateSummaryTo(summary, SUMMARY_MAX),
    body,
    topic_path: ["doku", projectKey, areaSlug],
    tags: parsed.data.tags ?? ["product-doc", projectKey],
    scope: projectKey,
    recall_when: parsed.data.recall_when ?? [
      `how to use ${title}`,
      `${project} ${area} user guide`,
    ],
    overwrite: true,
  });
  // Watcher is unreliable on cloud mounts — index now so find_document sees it.
  await deps.vault.reindexFile(result.file_path);

  // #206: product docs are vault writes like any other — they were the second
  // path with no audit record at all.
  await recordAudit({
    vaultRoot: deps.vaultPath,
    memoryId: result.id,
    operation: result.created ? "create" : "update",
    actor: "assistant",
    actorDetail: "mcp:save_product_doc",
    diffBefore: before ? { ...before.fm } : null,
    diffAfter: { ...(deps.vault.get(result.id)?.fm ?? {}) },
    filePath: result.file_path,
    sessionId: deps.telemetry.runId(),
  });

  return {
    id: result.id,
    file_path: result.file_path,
    created: !existed,
    updated: existed,
  };
}

export const productDocTools = [
  {
    name: "save_product_doc",
    description:
      "Create or update the PRODUCT documentation for one feature area of a " +
      "project — the living user-facing doc ('how do I use this?'), stored in " +
      "the vault under dokumentationen/<project>/. " +
      "\n\n" +
      "WHEN: after a user-facing feature area is COMPLETELY finished (works " +
      "end-to-end, user confirmed / commit landed) — not for work in progress. " +
      "Developer-facing state (file maps, architecture) does NOT go here; " +
      "that stays in save_memory type 'project-fact'.\n" +
      "\n" +
      "UPDATE-IN-PLACE: one doc per area, stable id doku-<project>-<area>. " +
      "Calling again with the same project+area REPLACES the body. So: " +
      "find_document/read_document the existing doc first, merge your changes " +
      "into the full text, and send the complete updated markdown — never a " +
      "fragment.\n" +
      "\n" +
      "BODY: write for the END USER of the product (features, how to use " +
      "them, tips, quirks) — no code internals, no file paths.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description:
            "Project the doc belongs to, e.g. 'bastra-recall' — becomes the " +
            "folder dokumentationen/<project>/.",
        },
        area: {
          type: "string",
          description:
            "Feature area this doc covers, e.g. 'user-guide', 'recall-tab', " +
            "'cli'. One doc per area; slugified into the id.",
        },
        title: {
          type: "string",
          description: "Human-readable doc title, e.g. 'Bastra — Recall-Tab'.",
        },
        summary: {
          type: "string",
          description:
            "One sentence: what this doc covers. Appears in find_document hits.",
        },
        body: {
          type: "string",
          description:
            "The COMPLETE markdown document (it replaces the previous body). " +
            "User-facing language, in the configured docs language.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional retrieval tags. Default: ['product-doc', <project>].",
        },
        recall_when: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional trigger phrases for retrieval, e.g. 'how do tabs work " +
            "in Bastra'. Sensible defaults are derived from title/area.",
        },
      },
      required: ["project", "area", "title", "summary", "body"],
    },
  },
];
