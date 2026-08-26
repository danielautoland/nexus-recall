/**
 * Split out of `save.ts` (#360 follow-up): the write path had grown past 800
 * lines, which is a context cost on every edit that touches it. Pure move —
 * no behaviour change, no renamed export.
 *
 * Where a memory's file goes. `scope` + `type` decide the default subfolder,
 * an explicit `folder` overrides it, and the result is resolved against the
 * vault root. Separate from the save itself so the daemon can ask "where would
 * this land" without a write.
 */
import { readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { SaveMemoryInput } from "./save-schema.js";
import { canonicalMemoryId } from "./save-text.js";
import { normalizeScopeKey } from "./scope.js";

/**
 * Subfolder routing inside the vault.
 *
 * Top-level layout (three siblings):
 *   memories/         lessons, decisions, preferences, project-facts,
 *                     workflows — anything the agent learned and wants
 *                     to recall later.
 *     ├── user/             scope = "user-preference"
 *     ├── all-projects/     scope = "all-projects"
 *     └── projects/<scope>/ everything else
 *
 *   bookmarks/        type = "bookmark" — saved URLs with url/og_image.
 *                     Kept as a sibling because bookmarks aren't really
 *                     "memories" and carry their own metadata shape.
 *
 *   dokumentationen/  type = "doc" — living per-project documentation
 *                     ("software wiki"). Routed to dokumentationen/<scope>/
 *                     so each project owns its docs.
 *
 * The vault scans recursively, so older flat `memorys/` files continue to
 * work until they are migrated.
 */
/**
 * Die exakten `scope === …`-Vergleiche hier sind seit #360-D unkritisch: der
 * EINZIGE produktive Aufrufer ist `resolveMemoryTarget`, und der übergibt den
 * kanonischen Key (`normalizeScopeKey`). Ein roher "User-Preference" kann
 * diese Zweige also nicht mehr verfehlen. Wer die Funktion künftig direkt
 * aufruft, faltet vorher selbst.
 */
export function subfolderFor(scope: string, type: string): string {
  if (type === "bookmark") return "bookmarks";
  if (type === "doc") return `dokumentationen/${scope}`;
  if (scope === "user-preference") return "memories/user";
  if (scope === "all-projects") return "memories/all-projects";
  // Reservierter Ort für selbst-etablierte Taxonomie-Konventionen (#65):
  // Regeln, die beschreiben, wie der Vault künftig strukturiert wird
  // ("Personen nach memories/people/, Tag person, …"). Die Hooks laden
  // diesen Scope bei Session-Start und injizieren ihn als Kontext.
  if (scope === "taxonomy") return "memories/taxonomy";
  return `memories/projects/${scope}`;
}

/**
 * Bestandsschutz für die Kanonisierung (Codex-Gegenreview zu #360-D).
 *
 * Die Faltung ist richtig für NEUE Memories, darf aber kein bestehendes
 * unerreichbar machen. Ein Vault mit `Upper-ID.md` (oder einem Regal `Proj/`)
 * hätte sonst zwei Ausgänge, beide falsch: auf einem case-SENSITIVEN System
 * entsteht `upper-id.md` daneben — ein Duplikat, das `overwrite: true` still
 * ignoriert; auf einem case-INSENSITIVEN System trifft der Schreibvorgang die
 * alte Datei, lässt ihren Namen stehen und setzt im Frontmatter die neue id —
 * Datei und id fallen auseinander (auf APFS nachgestellt).
 *
 * Also: Existiert das kanonische Ziel EXAKT nicht, das rohe aber schon, wird
 * das rohe bedient und die alte Schreibweise beibehalten. Kein Rename, keine
 * Migration — Bestandsdaten bleiben genau so bedienbar wie vorher, und alles
 * Neue ist kanonisch.
 *
 * `readdirSync` statt `existsSync`, weil `existsSync` auf case-insensitiven
 * Dateisystemen für `upper-id.md` true meldet, wenn `Upper-ID.md` daliegt —
 * genau die Verwechslung, die hier auseinandergehalten werden muss. Der
 * Zweig läuft nur, wenn roh und kanonisch überhaupt auseinandergehen: bei
 * jedem normalen Save kostet er nichts.
 */
function resolveAgainstExisting(
  vaultRoot: string,
  input: MemoryTargetInput,
  canonicalId: string,
  canonicalSubdir: string,
): { id: string; subdir: string } {
  const rawId = input.id ?? canonicalId;
  const rawSubdir = input.folder ?? subfolderFor(input.scope, input.type);
  if (rawId === canonicalId && rawSubdir === canonicalSubdir) {
    return { id: canonicalId, subdir: canonicalSubdir };
  }
  if (existsExactPath(vaultRoot, `${canonicalSubdir}/${canonicalId}.md`)) {
    return { id: canonicalId, subdir: canonicalSubdir };
  }
  if (existsExactPath(vaultRoot, `${rawSubdir}/${rawId}.md`)) {
    return { id: rawId, subdir: rawSubdir };
  }
  return { id: canonicalId, subdir: canonicalSubdir };
}

/** Existiert dieser Pfad mit GENAU dieser Schreibweise? Jedes Segment einzeln,
 *  weil ein case-insensitives Dateisystem sonst schon beim Ordner lügt: ein
 *  `readdirSync("…/proj")` öffnet dort klaglos `Proj/` und meldet dessen
 *  Inhalt — die Datei sähe kanonisch vorhanden aus, obwohl sie im alten Regal
 *  liegt. */
function existsExactPath(root: string, relPath: string): boolean {
  let cur = root;
  for (const segment of relPath.split("/")) {
    try {
      if (!readdirSync(cur).includes(segment)) return false;
    } catch {
      return false;
    }
    cur = join(cur, segment);
  }
  return true;
}

export type MemoryTargetInput = Pick<
  SaveMemoryInput,
  "title" | "type" | "scope" | "id" | "folder"
>;

export interface MemoryTarget {
  id: string;
  filePath: string;
  /** Der Scope, den das Frontmatter tragen MUSS, damit er zum Ordner passt.
   *  Normalerweise der kanonische Key; im Bestandsfall (siehe
   *  {@link resolveAgainstExisting}) die alte Schreibweise, weil die Datei
   *  weiterhin im alten Regal liegt. */
  scope: string;
}

/**
 * Resolve the exact file `saveMemory` will write.
 *
 * Callers that need a pre-write snapshot (for example the daemon audit trail)
 * must use the same routing and containment check as the writer instead of
 * duplicating `subfolderFor`. This is a routing primitive, not a second save
 * API: a path escape is a write failure and must throw rather than being
 * downgraded to "audit unavailable".
 */
export function resolveMemoryTarget(
  vaultRoot: string,
  input: MemoryTargetInput,
): MemoryTarget {
  const canonicalId = canonicalMemoryId(input.id, input.title);
  // #360-Folgefund D: `scope` wird hier zum ORDNERNAMEN. Ein roher
  // Projektname ("CarNexus") legte damit ein zweites Regal neben dem
  // kanonischen an — auf case-insensitiven Dateisystemen sogar dasselbe
  // Regal unter zwei Namen. Gefaltet über die zentrale Scope-Identität;
  // `save.ts` schreibt denselben Key ins Frontmatter, damit Ordner und
  // `scope:` nie auseinanderlaufen.
  const canonicalSubdir = input.folder ?? subfolderFor(normalizeScopeKey(input.scope), input.type);
  const { id, subdir } = resolveAgainstExisting(vaultRoot, input, canonicalId, canonicalSubdir);
  const scope = subdir === canonicalSubdir ? normalizeScopeKey(input.scope) : input.scope;
  const filePath = join(vaultRoot, subdir, `${id}.md`);
  if (!resolve(filePath).startsWith(resolve(vaultRoot) + sep)) {
    throw new Error(`refusing to write outside the vault: ${filePath}`);
  }
  return { id, filePath, scope };
}
