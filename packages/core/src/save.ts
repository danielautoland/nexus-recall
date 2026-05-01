import { writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import matter from "gray-matter";
import { MemoryTypeEnum } from "./schema.js";

/**
 * Input contract for save_memory.
 * Mirrors FrontmatterSchema but only the fields a caller should set —
 * id, created, updated are auto-derived; obsolete/replaces/superseded_by
 * are written by separate flows, not by save.
 */
export const SaveMemoryInput = z.object({
  title: z.string().min(1),
  type: MemoryTypeEnum,
  summary: z.string().min(1).max(400),
  body: z.string().min(1),
  topic_path: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string().min(1)).min(1),
  scope: z.string().min(1),
  recall_when: z.array(z.string().min(1)).min(1),
  related: z.array(z.string()).optional(),
  source: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  affects_files: z.array(z.string()).optional(),
  issues: z.array(z.string()).optional(),
  id: z.string().optional(),
  overwrite: z.boolean().optional(),
});
export type SaveMemoryInput = z.infer<typeof SaveMemoryInput>;

export interface SaveMemoryResult {
  id: string;
  file_path: string;
  created: boolean;
}

const SLUG_MAX_LEN = 80;

export function slugify(input: string): string {
  const lower = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "");
  const slug = lower
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LEN);
  if (!slug) throw new Error(`cannot slugify: ${JSON.stringify(input)}`);
  return slug;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the .md content for a new memory and write it into the vault.
 * The vault watcher will pick it up and index it automatically.
 */
export async function saveMemory(
  vaultRoot: string,
  input: SaveMemoryInput,
): Promise<SaveMemoryResult> {
  const id = input.id ?? slugify(input.title);
  const filePath = join(vaultRoot, `${id}.md`);
  const exists = await fileExists(filePath);
  if (exists && !input.overwrite) {
    throw new Error(
      `memory already exists: ${id}. Pass overwrite=true to replace it, ` +
        `or pick a different title/id.`,
    );
  }

  const today = todayISO();
  const fm = {
    id,
    title: input.title,
    type: input.type,
    summary: input.summary,
    topic_path: input.topic_path,
    tags: input.tags,
    scope: input.scope,
    recall_when: input.recall_when,
    related: input.related ?? [],
    ...(input.source ? { source: input.source } : {}),
    confidence: input.confidence ?? 1,
    created: today,
    updated: today,
    affects_files: input.affects_files ?? [],
    issues: input.issues ?? [],
  };

  const body = input.body.startsWith("\n") ? input.body : `\n${input.body}`;
  const content = matter.stringify(body, fm);

  await writeFile(filePath, content, "utf8");
  return { id, file_path: filePath, created: !exists };
}
