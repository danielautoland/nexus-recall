/** The four live-event kinds, in one place (#216/#217).
 *
 *  Extracted from live-updates.js because live-deck.js needs the same table to
 *  label the hidden-cards breakdown, and importing it from there would close a
 *  cycle: live-updates imports live-deck.
 *
 *  - icon  — the glyph on a notice card
 *  - label — what the card and the history row say
 *  - short — the compact form for the "+N" bar, where four kinds share 280px
 *  - flash — the colour a node lights up in. `add` deliberately has none: on
 *    the live path a birth is the supernova, not a flare. */
export const KIND_META = {
  add: { label: "new memory", short: "new", icon: "✦" },
  change: { label: "updated", short: "updated", icon: "✎", flash: "hsl(40 65% 55%)" },
  delete: { label: "deleted", short: "deleted", icon: "✕", flash: "hsl(8 65% 58%)" },
  read: { label: "read", short: "read", icon: "◉", flash: "hsl(210 35% 68%)" },
};
