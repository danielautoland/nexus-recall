/** Live-notice deck (#217) — the presentation half of the notice lane.
 *  managers/live-updates.js owns WHAT is announced; this owns how the pile
 *  looks. It never creates or removes a card, it only reacts to the ones that
 *  are there.
 *
 *  Three rules the deck follows:
 *    1. The newest card covers AT MOST two others. Beyond that a pile stops
 *       reading as a pile and starts reading as clutter, and a busy minute
 *       would bury the map it is reporting on.
 *    2. Everything past those three is counted, not drawn — one small bar
 *       saying how many are still down there.
 *    3. Scrolling is shown by tick marks on the left, not by a scrollbar. The
 *       native one is suppressed: a full-height bar next to a 280px lane is
 *       visually louder than the notices themselves, and the ticks double as a
 *       density readout — you can see at a glance whether three things or
 *       thirty happened.
 *
 *  @param {object} deps
 *  @param {HTMLElement} deps.cardsEl  the card container (scroll owner) */

import { KIND_META } from "./live-kinds.js";

const $ = (sel) => document.querySelector(sel);

/** Cards the collapsed deck shows: the top one plus the two it covers. */
const DECK_VISIBLE = 3;

/** Order the hidden-kind breakdown is read in — loudest event first, so a
 *  deletion never hides behind a pile of reads. */
const KIND_ORDER = ["delete", "add", "change", "read"];

export function createLiveDeck({ cardsEl }) {
  const ticksEl = $("#live-ticks");
  const moreEl = $("#live-more");
  const stackEl = $("#live-stack");
  const laneEl = $("#live-lane");
  let activeIndex = 0;

  const cards = () => [...cardsEl.children];

  /** Which tick is lit, from the scroll POSITION rather than from which card
   *  happens to sit at the top edge.
   *
   *  The first version asked "which is the topmost fully scrolled-past card",
   *  which can never reach the last one: scrolled all the way down, the final
   *  card sits at the BOTTOM of the port, not the top, so the rail stopped one
   *  or two marks short of the end and the deck looked like it had more below.
   *  A fraction of the scrollable distance is exact at both ends by
   *  construction — 0 at the top, n-1 at the bottom. */
  function computeActive() {
    const n = cards().length;
    if (n < 2) return 0;
    const scrollable = cardsEl.scrollHeight - cardsEl.clientHeight;
    if (scrollable <= 1) return 0; // nothing to scroll — everything is "at the top"
    const frac = Math.min(Math.max(cardsEl.scrollTop / scrollable, 0), 1);
    return Math.round(frac * (n - 1));
  }

  function paintTicks() {
    const list = cards();
    // one tick is not a scale, it is a dot — hide the rail until there is
    // actually something to navigate
    ticksEl.hidden = list.length < 2;
    if (ticksEl.hidden) {
      ticksEl.replaceChildren();
      return;
    }
    if (ticksEl.children.length !== list.length) {
      ticksEl.replaceChildren(
        ...list.map(() => {
          const t = document.createElement("span");
          t.className = "lt-tick";
          return t;
        }),
      );
    }
    [...ticksEl.children].forEach((t, i) => {
      t.classList.toggle("active", i === activeIndex);
      // neighbours of the active tick lean towards it, so the mark reads as a
      // position on a rail instead of a lone bright dash
      t.classList.toggle("near", Math.abs(i - activeIndex) === 1);
    });
    fitTicks(list.length);
  }

  /** Keep the rail no taller than the deck beside it.
   *
   *  The rail draws one mark per notice, but the collapsed deck is only ever
   *  three cards tall — so past a handful of notices the rail grew straight
   *  past the top of the stack and stopped reading as its axis. The marks
   *  themselves are fixed at 2px (any thinner and they vanish), so the only
   *  thing that can give is the spacing between them: it shrinks to fit and
   *  bottoms out at MIN_GAP. At that floor roughly 30 marks still fit beside a
   *  collapsed deck, well past what the 120s card lifetime produces — beyond
   *  it the overflow clips at the TOP, i.e. the oldest end, which is also the
   *  end you care about least. */
  function fitTicks(count) {
    const MAX_GAP = 7;
    const MIN_GAP = 1;
    const TICK_H = 2;
    const available = stackEl.offsetHeight;
    if (!available || count < 2) return;
    const gap = (available - count * TICK_H) / (count - 1);
    ticksEl.style.gap = `${Math.min(Math.max(gap, MIN_GAP), MAX_GAP)}px`;
  }

  /** The kind of a card, read back off its own class. The cards are the single
   *  source of truth here — live-deck never sees the update objects, and a
   *  parallel tally would drift the moment a card expires on its own timer.
   *  Summary cards ("+N more live events") carry no kind and count only
   *  towards the total. */
  function kindOf(card) {
    for (const c of card.classList) {
      if (c.startsWith("kind-")) return c.slice(5);
    }
    return null;
  }

  /** "+4  ✕1 · ◉3" — how many are still below, and WHAT they were. A bare
   *  count would hide the one thing worth surfacing: a deletion buried under a
   *  pile of reads still deserves to be noticed. */
  function paintMore() {
    const hiddenCards = cards().slice(DECK_VISIBLE);
    moreEl.hidden = hiddenCards.length === 0;
    if (moreEl.hidden) return;

    const tally = new Map();
    for (const c of hiddenCards) {
      const k = kindOf(c);
      if (k) tally.set(k, (tally.get(k) ?? 0) + 1);
    }

    const total = document.createElement("span");
    total.className = "lm-total";
    total.textContent = `+${hiddenCards.length}`;

    const parts = KIND_ORDER.filter((k) => tally.has(k)).map((k) => {
      const meta = KIND_META[k];
      const chip = document.createElement("span");
      chip.className = `lm-kind kind-${k}`;
      chip.textContent = `${meta.icon} ${tally.get(k)} ${meta.short}`;
      return chip;
    });
    moreEl.replaceChildren(total, ...parts);
  }

  /** Stagger the fan-out from the BOTTOM card upwards.
   *
   *  Cards are prepended, so the newest is the FIRST child and the oldest the
   *  last — counting from the end gives the visual bottom-to-top order. Every
   *  card also waits out FAN_LEAD first, which is how long the lane takes to
   *  drift down: the deck settles, THEN it opens, instead of doing both at
   *  once and reading as a jump. */
  function paintFanDelays() {
    const FAN_LEAD = 0.1; // s — the lane's downward drift goes first
    const FAN_STEP = 0.035; // s per card, bottom → top
    const list = cards();
    list.forEach((card, i) => {
      const fromBottom = list.length - 1 - i;
      card.style.setProperty("--fan-delay", `${FAN_LEAD + fromBottom * FAN_STEP}s`);
    });
  }

  /** Called by live-updates.js after any card was added or removed. */
  function sync() {
    activeIndex = computeActive();
    paintTicks();
    paintMore();
    paintFanDelays();
  }

  // The deck changes height when it opens, so the rail's spacing has to be
  // recomputed — after the transition, not during it, or it measures a size
  // the deck is still moving through.
  laneEl.addEventListener("mouseenter", () => setTimeout(() => paintTicks(), 320));
  laneEl.addEventListener("mouseleave", () => setTimeout(() => paintTicks(), 320));

  cardsEl.addEventListener("scroll", () => {
    const next = computeActive();
    if (next === activeIndex) return;
    activeIndex = next;
    paintTicks();
  });

  return { sync };
}
