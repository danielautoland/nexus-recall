import { slugify } from "@bastra-recall/core";

export const WIKILINK_RE = /\[\[([a-z0-9][a-z0-9_-]{0,79})\]\]/g;

/** Namespace every body `[[x]]` → `[[slugify(<label>-x)]]` so intra-set links
 *  stay inside the imported set and can NEVER resolve onto a hand-authored
 *  memory with a bare-name id (the isolation guarantee). #219 (zzallirog):
 *  the SAME slugify as the id minting in `buildInput` — without it every
 *  underscored note became its own ghost twin (`[[feedback_gate_catalog]]`
 *  stayed underscored while the id got dashes; 326 of his 402 ghosts). Links
 *  whose namespaced form exceeds the 80-char wikilink cap simply don't
 *  become edges — harmless. */
export function namespaceWikilinks(body: string, label: string, idByBase: Map<string, string>): string {
  return body.replace(WIKILINK_RE, (full: string, id: string) => {
    try {
      // #240/A10: prefer the minted id for this basename; fall back to the
      // legacy scheme only for targets outside the imported set.
      return `[[${idByBase.get(linkKey(id) ?? id) ?? slugify(`${label}-${id}`)}]]`;
    } catch {
      return full; // unslugifiable target — leave untouched, never throw mid-body
    }
  });
}

/** slugify that returns null instead of throwing/emptying — for optional
 *  section folders and veto-id derivation. */
/**
 * Normalization for the basename ↔ wikilink map (#240/A10 follow-up). Source
 * bodies write `[[two]]` while the file on disk is `Two.md`, and the pre-A10
 * ghost wave (#219) was the same class of mismatch with underscores. Both
 * sides of the map MUST pass through this, or the lookup misses and the
 * legacy fallback mints a target that was never created.
 */
/** Escape a label for use inside a RegExp — labels are user-supplied. */
export function escapeRe(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function linkKey(raw: string): string | null {
  return safeSlug(raw);
}

export function safeSlug(raw: string): string | null {
  try {
    const s = slugify(raw);
    return s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

/** Ensure a batch-unique id: on collision append -2, -3, … (deterministic). */
export function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}
