/** The topbar memory counter (#294) — a measurement, not a running total.
 *
 *  It used to be seeded once from `graph.vault_size` at load and then only ever
 *  nudged by ±1 per live event, reading its own displayed text to do so. Two
 *  paths drop events without a nudge — a buffer overflow past the cursor, and a
 *  daemon restart that rebaselines the cursor — so every missed event became
 *  permanent drift against the statusline, until someone reloaded the page. The
 *  gap was not explainable from the vault: it recorded how many events that
 *  particular tab happened to miss.
 *
 *  So the delta stays (the number has to react the instant a memory is born —
 *  that is the whole point of live mode), but it is no longer the authority.
 *  `vault_size` from /health is, and it is read back on both rebaseline paths
 *  and on a slow cadence. The same value the statusline reads, which is what
 *  "agrees with the statusline" has to mean.
 *
 *  DOM-free on purpose: `read`/`write` are injected, so the arithmetic and the
 *  reconcile cadence are testable without a browser.
 *
 *  @param {object} deps
 *  @param {() => number|null} deps.read       currently displayed count, null if none
 *  @param {(n: number) => void} deps.write    render a count
 *  @param {() => Promise<number|null>} deps.fetchSize  authoritative vault size
 *  @param {number} [deps.reconcileEveryPolls] polls between slow reconciles
 */
export function createMemoryCounter({ read, write, fetchSize, reconcileEveryPolls = 20 }) {
  let pollsSinceReconcile = 0;

  /** Pull the authoritative size and display it. Silent on failure — the next
   *  reconcile retries, and a wrong number is worse than a late one. */
  async function reconcile() {
    pollsSinceReconcile = 0;
    let size = null;
    try {
      size = await fetchSize();
    } catch {
      return;
    }
    if (typeof size !== "number" || !Number.isFinite(size)) return;
    if (read() === size) return; // no pulse for a value that did not move
    write(size);
  }

  return {
    /** Optimistic ±N from the events of one poll. */
    bump(delta) {
      if (delta === 0) return;
      const cur = read();
      if (cur === null) return; // nothing displayed yet — reconcile will seed it
      write(cur + delta);
    },

    reconcile,

    /** Called once per completed poll; reconciles when the cadence comes due. */
    afterPoll() {
      if (++pollsSinceReconcile < reconcileEveryPolls) return;
      void reconcile();
    },
  };
}
