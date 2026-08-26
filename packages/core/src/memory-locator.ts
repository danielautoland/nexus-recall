/**
 * Memory-Identität als EINE Auskunft: Welche Datei gehört zu dieser id, und
 * was liegt eigentlich an einem gegebenen Pfad?
 *
 * Die Reparaturkette um #360 hat gezeigt, warum das eine eigene Stelle braucht.
 * Der Save-Pfad hatte drei getrennte, jeweils zu schwache Regeln — „am
 * Zielpfad liegt irgendeine Datei, also ist sie das Ziel", „eine Datei heißt
 * so wie die id, also ist sie das Memory", „ein YAML-Feld `id` passt, also ist
 * es ein Memory" — und jede einzelne ließ sich in einen Datenverlust
 * übersetzen. Nachgestellt, alle drei:
 *
 *   - Eine gewöhnliche Obsidian-Notiz am kanonischen Zielpfad wurde bei
 *     `overwrite: true` vollständig ersetzt.
 *   - Ein FREMDES Memory (`id: other-id`) am erwarteten Pfad für `upper-id`
 *     wurde überschrieben und dabei auf `upper-id` umgeschrieben.
 *   - Eine Notiz mit einem zufälligen YAML-Feld `id: Upper-ID` (Obsidian
 *     kennt viele solche Felder) wurde als Memory behandelt und ersetzt.
 *
 * Die Antwort auf alle drei ist dieselbe: Was ein Memory ist, entscheidet
 * `parseMemoryWith` — die Funktion, mit der auch der Vault seinen Index baut.
 * Sie verlangt ein bekanntes `type` und repariert eine fehlende id aus dem
 * Dateinamen, und beides muss hier genauso gelten, sonst weichen Index und
 * Save-Pfad in ihrer Vorstellung davon ab, was existiert.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import matter from "gray-matter";
import { parseMemoryWith } from "./schema.js";
// Case-insensitiv: Der Vault-Watcher akzeptiert `.MD`, also darf ein Scanner
// daneben nicht strenger sein — sonst sieht der Save eine Datei nicht, die der
// Index sehr wohl kennt. Die Regel steht zentral in markdown-file.ts.
import { isMarkdownFile as isMarkdown } from "./markdown-file.js";

/** Was an einem konkreten Pfad liegt. */
export type Occupant =
  /** Nichts — oder etwas Unlesbares, das wie nichts behandelt wird. */
  | { kind: "absent" }
  /** Ein echtes Memory, mit seiner EFFEKTIVEN id (nach der Reparatur, die
   *  auch der Vault-Index anwendet). */
  | { kind: "memory"; id: string }
  /** Eine Datei, die der Vault nicht als Memory indexieren würde — eine
   *  gewöhnliche Notiz, ein Anhang-Sidecar, was auch immer. Sie darf ein Save
   *  niemals überschreiben. */
  | { kind: "foreign" };

/** Wo ein Memory mit dieser id liegt. `ambiguous` ist kein Ausnahmefall,
 *  sondern ein Vault-Defekt (#240/A2.3): Zwei Dateien mit derselben id lassen
 *  den Index still eine davon wählen. „Erster gewinnt" wäre hier eine
 *  Entscheidung, die dem Aufrufer nicht zusteht. */
export type Located =
  | { kind: "none" }
  | { kind: "unique"; filePath: string }
  | { kind: "ambiguous"; filePaths: string[] };

/**
 * Die Auskunft, die der Save-Pfad braucht. Der Daemon reicht eine Fassung
 * durch, die den bereits geladenen Vault-Index befragt; ohne Injektion fällt
 * `saveMemory` auf {@link scanVaultForId} zurück, das dasselbe beantwortet,
 * nur teurer.
 */
export interface MemoryLocator {
  locate(id: string): Located;
}

/** Was liegt an diesem Pfad? Fehler beim Lesen und beim Parsen sind dasselbe
 *  wie „kein Memory" — mit einem Unterschied: eine EXISTIERENDE Datei, die
 *  sich nicht als Memory parsen lässt, ist `foreign` und damit geschützt. */
export function readOccupant(filePath: string): Occupant {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return { kind: "absent" };
  }
  try {
    // mtime 0: die Reparatur benutzt sie nur für abgeleitete Zeitstempel, und
    // hier interessiert ausschließlich die effektive id.
    const parsed = parseMemoryWith((input) => matter(input), raw, filePath, 0);
    return { kind: "memory", id: parsed.fm.id };
  } catch {
    return { kind: "foreign" };
  }
}

/**
 * Vaultweiter Scan nach der effektiven id. Der Rückfall für Aufrufer ohne
 * Index — teuer genug, dass `saveMemory` ihn nur stellt, wenn die Frage
 * überhaupt offen ist.
 */
export function scanVaultForId(vaultRoot: string, id: string): Located {
  const found: string[] = [];
  walk(vaultRoot, vaultRoot, id, found);
  if (found.length === 0) return { kind: "none" };
  if (found.length === 1) return { kind: "unique", filePath: found[0] };
  return { kind: "ambiguous", filePaths: found };
}

function walk(vaultRoot: string, dir: string, id: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    // `.bastra/trash` enthält gelöschte Memories, die ihre id behalten — ein
    // Treffer dort wäre eine Auferstehung, kein Fund.
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(vaultRoot, full, id, out);
      continue;
    }
    if (!e.isFile() || !isMarkdown(e.name)) continue;
    const occupant = readOccupant(full);
    if (occupant.kind === "memory" && occupant.id === id) out.push(full);
  }
}

/** Für Fehlermeldungen: der Pfad relativ zum Vault, in Vault-Schreibweise. */
export function vaultRelative(vaultRoot: string, filePath: string): string {
  return relative(vaultRoot, filePath).split(sep).join("/");
}

/**
 * Ein Locator aus EINEM Vault-Scan, für Aufrufer ohne geladenen Index, die
 * viele Identitätsfragen hintereinander stellen — der Folder-Import etwa
 * prüft für jede Quelldatei, ob ihre id schon jemandem gehört.
 *
 * `scanVaultForId` einzeln zu rufen wäre dort ein Scan JE DATEI. Dieser
 * Snapshot kostet einen und beantwortet alle, inklusive `ambiguous`: Die Map
 * hält je id ALLE Fundstellen, anders als ein Vault-Index, der je id genau
 * einen Eintrag führen kann.
 *
 * Der Snapshot altert, sobald geschrieben wird. Für „gehört diese id schon
 * jemandem, BEVOR ich anfange" ist genau das die richtige Frage; wer während
 * des Laufs Geschriebenes wiederfinden muss, führt sein eigenes Set (der
 * Import tut das mit `used`).
 */
export function snapshotLocator(vaultRoot: string): MemoryLocator {
  const byId = new Map<string, string[]>();
  collect(vaultRoot, vaultRoot, byId);
  return {
    locate(id: string): Located {
      const hits = byId.get(id);
      if (hits === undefined || hits.length === 0) return { kind: "none" };
      if (hits.length === 1) return { kind: "unique", filePath: hits[0] };
      return { kind: "ambiguous", filePaths: hits };
    },
  };
}

function collect(vaultRoot: string, dir: string, out: Map<string, string[]>): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      collect(vaultRoot, full, out);
      continue;
    }
    if (!e.isFile() || !isMarkdown(e.name)) continue;
    const occupant = readOccupant(full);
    if (occupant.kind !== "memory") continue;
    const list = out.get(occupant.id);
    if (list === undefined) out.set(occupant.id, [full]);
    else list.push(full);
  }
}
