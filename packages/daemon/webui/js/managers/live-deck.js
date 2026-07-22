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
import { createTickRail } from "../components/tick-rail.js";

const KIND_ORDER = ["delete", "add", "change", "read"];

/** A card's kind, read back off the class live-updates.js gave it.
 *
 *  The deck deliberately owns no state about the cards — it reads what is in
 *  the DOM, so it cannot drift out of sync with the manager that creates them.
 *  Summary cards ("+N older changes") carry no kind class and return null:
 *  they are counted in the total but have nothing to tally. */
function kindOf(card) {
  for (const cls of card.classList) {
    if (cls.startsWith("kind-")) return cls.slice("kind-".length);
  }
  return null;
}

export function createLiveDeck({ cardsEl }) {
  const ticksEl = $("#live-ticks");
  const moreEl = $("#live-more");
  const stackEl = $("#live-stack");
  const laneEl = $("#live-lane");
  // Die Leiste selbst lebt in components/tick-rail.js — dieselbe benutzt die
  // Live-Historie. Der Stapel gibt die Höhe vor, nicht die Kartenliste: die
  // Leiste hängt absolut an ihm (siehe live.css).
  const rail = createTickRail({ railEl: ticksEl, scrollEl: cardsEl, sizeEl: stackEl });

  const cards = () => [...cardsEl.children];

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

  /** Stagger the fan-out from the TOP card downwards.
   *
   *  Cards are prepended, so the first child is the newest and sits on top of
   *  the pile. It leaves first, the card beneath follows, and the ones the deck
   *  was hiding come up last — the order the eye already reads the deck in.
   *  Going bottom-up instead made the oldest note lead the movement, which is
   *  backwards for a stack you read from the top.
   *
   *  FAN_LEAD is not decoration: it holds every card still until #live-more has
   *  finished collapsing (0.34s in live.css), so the pile slides down as one
   *  block before anything unfolds. Overlap the two and the gesture reads as
   *  two competing animations. */
  function paintFanDelays() {
    const FAN_LEAD = 0.34; // s — matches #live-more's collapse in live.css
    // The three the deck shows are read one at a time: each reaches its resting
    // gap before the next starts, so the eye follows a sequence instead of
    // watching a block expand. The covered cards then arrive as one wave —
    // stepping them this slowly would turn twenty notices into five seconds.
    const STACK_STEP = 0.14; // s between the visible cards
    const TAIL_GAP = 0.1; // s of quiet before the hidden ones start
    const TAIL_STEP = 0.05; // s between the hidden ones
    const stackTail = FAN_LEAD + (DECK_VISIBLE - 1) * STACK_STEP + TAIL_GAP;
    const list = cards();
    // How far a covered card has to sit above its slot to be COMPLETELY behind
    // the pile. The deck's resting overlap (-62px) only hides a card of that
    // height — a real notice is taller, so a card starting there began its
    // journey already sticking out, which reads as appearing rather than
    // sliding. Measured off the visible cards, since the covered ones are
    // display:none and report no height of their own.
    const tallest = list
      .slice(0, DECK_VISIBLE)
      .reduce((max, c) => Math.max(max, c.offsetHeight), 0);
    if (tallest > 0) cardsEl.style.setProperty("--card-hide", `-${tallest + 16}px`);
    list.forEach((card, i) => {
      // the first child has no preceding sibling, so the rule that animates
      // margin-top never applies to it — the second card opens the fan
      const delay =
        i < DECK_VISIBLE
          ? FAN_LEAD + Math.max(0, i - 1) * STACK_STEP
          : stackTail + (i - DECK_VISIBLE) * TAIL_STEP;
      card.style.setProperty("--fan-delay", `${delay.toFixed(3)}s`);
    });
  }

  /** Called by live-updates.js after any card was added or removed. */
  function sync() {
    rail.update(cards().length);
    paintMore();
    paintFanDelays();
  }

  // The deck changes height when it opens, so the rail's spacing has to be
  // recomputed — after the transition, not during it, or it measures a size
  // the deck is still moving through.
  laneEl.addEventListener("mouseenter", () => setTimeout(() => rail.paint(cards().length), 320));
  laneEl.addEventListener("mouseleave", () => setTimeout(() => rail.paint(cards().length), 320));

  cardsEl.addEventListener("scroll", () => {
    if (rail.sync(cards().length)) rail.paint(cards().length);
  });

  return { sync };
}
