/** Dauerauslöser: fires flares on random memories so the activity animation
 *  can be judged without poking the vault (#217).
 *
 *  Deliberately NOT persisted and never on by default. A flare means "this
 *  memory was just touched" — if the loop survived a reload, the map would be
 *  telling that story about memories nobody read. It is a workbench light, so
 *  it goes out when you leave the room.
 */

import { KIND_META } from "./live-kinds.js";

const EVERY_MS = 1100; // slow enough that a chain finishes before the next one
const KINDS = ["change", "read", "delete"]; // `add` is a supernova, not a flare

export function createBoltDemo({ renderer, sim }) {
  let timer = null;

  /** One flare on a random visible memory. */
  function fireOnce() {
    const pool = sim.nodes.filter((n) => !n.ringHidden && n.kind !== "ghost");
    if (!pool.length) return null;
    const n = pool[Math.floor(Math.random() * pool.length)];
    const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
    renderer.flashNode?.(n.id, KIND_META[kind].flash, 4000);
    return { id: n.id, kind };
  }

  return {
    fireOnce,
    isRunning: () => timer !== null,
    start() {
      if (timer !== null) return;
      fireOnce(); // immediate feedback — waiting a second for the first flare reads as "broken"
      timer = setInterval(fireOnce, EVERY_MS);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
