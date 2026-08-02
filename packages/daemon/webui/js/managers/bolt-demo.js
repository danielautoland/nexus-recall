/** Dauerauslöser: fires flares on random memories so the activity animation
 *  can be judged without poking the vault (#217).
 *
 *  Deliberately NOT persisted and never on by default. A flare means "this
 *  memory was just touched" — if the loop survived a reload, the map would be
 *  telling that story about memories nobody read. It is a workbench light, so
 *  it goes out when you leave the room.
 *
 *  The steady 1.1 s rhythm is the demo. On top of it, every 15-35 s one of the
 *  BIGGEST hubs fires instead of a random note: a flare travels the node's
 *  connections, so a well-connected one fans out across the map where an
 *  ordinary memory only produces a short stub. That occasional wide discharge
 *  is the thing worth watching; the constant small ones keep it alive between.
 */

import { KIND_META } from "./live-kinds.js";

const EVERY_MS = 1100; // slow enough that a chain finishes before the next one
const KINDS = ["change", "read", "delete"]; // `add` is a supernova, not a flare

// How long between two hub discharges. Re-drawn every time so it never settles
// into a rhythm you stop noticing.
const HUB_MIN_MS = 15000;
const HUB_SPAN_MS = 20000; // → 15…35 s

/** Share of the vault that counts as "a big hub" — small enough that every pick
 *  really does fan out, large enough not to be the same node every time. */
const HUB_SHARE = 0.04;
const HUB_MIN = 6;

const hubTicks = () => Math.round((HUB_MIN_MS + Math.random() * HUB_SPAN_MS) / EVERY_MS);

export function createBoltDemo({ renderer, sim }) {
  let timer = null;
  let lastHubId = null;

  const livePool = () => sim.nodes.filter((n) => !n.ringHidden && n.kind !== "ghost");

  function flash(n) {
    if (!n) return null;
    const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
    renderer.flashNode?.(n.id, KIND_META[kind].flash, 4000);
    return { id: n.id, kind };
  }

  /** One flare on a random visible memory — the steady beat. */
  function fireOnce() {
    const pool = livePool();
    if (!pool.length) return null;
    return flash(pool[Math.floor(Math.random() * pool.length)]);
  }

  /** One flare on a big hub — the occasional wide discharge. */
  function fireHub() {
    const pool = livePool();
    if (!pool.length) return null;
    const ranked = [...pool].sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0));
    const hubs = ranked.slice(0, Math.max(HUB_MIN, Math.round(pool.length * HUB_SHARE)));
    // not the same hub twice running — at 15-35 s apart a repeat reads as stuck
    const choices = hubs.length > 1 ? hubs.filter((n) => n.id !== lastHubId) : hubs;
    const n = choices[Math.floor(Math.random() * choices.length)];
    lastHubId = n?.id ?? null;
    return flash(n);
  }

  return {
    fireOnce,
    fireHub,
    isRunning: () => timer !== null,
    start() {
      if (timer !== null) return;
      fireOnce(); // immediate feedback — waiting a second for the first flare reads as "broken"
      let ticks = 0;
      let nextHub = hubTicks();
      timer = setInterval(() => {
        // On a hub tick the hub fires INSTEAD of the random one, so the two
        // never overlap into a double flash.
        if (++ticks >= nextHub) {
          ticks = 0;
          nextHub = hubTicks();
          fireHub();
        } else {
          fireOnce();
        }
      }, EVERY_MS);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
