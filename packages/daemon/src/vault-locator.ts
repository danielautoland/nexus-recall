/**
 * Der {@link MemoryLocator} auf Basis des bereits geladenen Vault-Index.
 *
 * `saveMemory` fragt für jede Identitätsentscheidung, wo ein Memory liegt.
 * Ohne Auskunft fällt es auf einen vaultweiten Dateiscan zurück — korrekt,
 * aber auf einem Vault mit tausend Memories je Save spürbar, und beim
 * Bulk-Import summiert sich das. Der Daemon hat die Antwort ohnehin im
 * Speicher: Der Index ist nach effektiver id aufgebaut, also derselben
 * Identität, die der Locator meint.
 *
 * `ambiguous` kann diese Fassung nicht melden — der Index hält je id genau
 * einen Eintrag, das ist seine Natur. Genau deshalb ist die Doppel-Datei ein
 * stiller Defekt (#240/A2.3): Zwei Dateien mit derselben id lassen ihn eine
 * davon wählen. Der Save erkennt den Fall trotzdem, weil er den Pfad des
 * Kandidaten gegen sein Ziel hält.
 */
import type { Located, MemoryLocator } from "@bastra-recall/core";

export function vaultLocator(vault: {
  get(id: string): { filePath: string } | undefined;
}): MemoryLocator {
  return {
    locate(id: string): Located {
      const hit = vault.get(id);
      return hit === undefined ? { kind: "none" } : { kind: "unique", filePath: hit.filePath };
    },
  };
}
