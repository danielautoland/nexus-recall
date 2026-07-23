/** What happens where a discharge LANDS (#216).
 *
 *  Until now only the origin flared: the memory that was touched got the ring
 *  and the halo, and the strands carried light outward — but the far end of a
 *  strand stayed dark. The light arrived nowhere. This module gives the arrival
 *  its moment: a small strike at the node the bolt reaches, and a faint spill
 *  of that node's OTHER strands, so the neighbourhood registers the hit without
 *  competing with it.
 *
 *  The whole point is restraint. The origin is the event; an impact is the
 *  consequence of an event, and a consequence that shouts as loud as its cause
 *  reads as a second event. Every constant here is chosen to stay under the
 *  origin flare, and the spill is deliberately at the edge of visibility —
 *  "ein paar Stränge weiter leuchten, aber nicht so doll".
 *
 *  Split out of renderer.js, which is near the size where a small change means
 *  reading a large file (file-size convention).
 */

/** How many of the target's other strands glow along. Three is the most that
 *  still reads as "a couple"; beyond that a hub turns into a starburst. */
export const IMPACT_SPILL_MAX = 3;

/** Peak opacity of a spilled strand. Low on purpose — this is the quietest
 *  mark on the map, and it should stay that way. */
export const IMPACT_SPILL_ALPHA = 0.17;

/** Ceiling for the spill selection across one chain, so a dense galaxy cannot
 *  turn a single flare into hundreds of extra strokes per frame. */
export const IMPACT_SPILL_BUDGET = 18;

/** Everything AFTER the bolt, in FIXED milliseconds.
 *
 *  THE RULE (Daniel, repeatedly, finally understood): the slider — `boltMs` —
 *  is the display time of the FIRST bolt and NOTHING else. It must not appear
 *  in any other animation, not as a duration and not as a start offset. Every
 *  attempt that put `boltMs` (or `IMPACT_AT · boltMs`, or `max(floor, boltMs)`)
 *  into the strike or the follow-up was wrong for the same reason: it let the
 *  slider change an animation that is not the first bolt.
 *
 *  So the strike and the follow-up run on their OWN clock, measured from the
 *  moment the bolt reaches the target (its travel end). That hand-off point is
 *  the only place the bolt's length enters — as "when did the bolt finish", not
 *  as a duration of anything downstream. Change these to retune; none of them
 *  touches the slider. */
export const IMPACT_LEAD_MS = 250; // strike fires this long BEFORE the bolt's travel ends
export const IMPACT_MS = 2000; // strike animation length
export const SPILL_GAP_MS = 90; // pause between strike and follow-up
export const SPILL_MS = 1000; // follow-up animation length on the onward strands

/** Rise/decay split of the 0→1→0 brightness curve. A quarter up, three
 *  quarters down, so it reads as a strike and not a breath. */
const IMPACT_RISE = 0.25;

/** 0 → 1 → 0 over a window, normalised so the peak is a true 1. */
function shape(u) {
  if (u <= 0 || u >= 1) return 0;
  return (Math.min(u / IMPACT_RISE, 1) * (1 - u)) / (1 - IMPACT_RISE);
}

/** Milliseconds since the strike fired.
 *
 *  The strike fires a FIXED IMPACT_LEAD_MS before the bolt finishes travelling
 *  — the head reaches the target shortly before the tail burns out, and that is
 *  when the hit should register. A constant lead, never a fraction of the
 *  length: shorten the bolt and the end moves in, but the strike stays exactly
 *  IMPACT_LEAD_MS ahead of it, at the same on-screen distance every time. This
 *  `legDur` is the ONLY use of the bolt's length past the bolt itself. */
function sinceArrival(legMs, legDur) {
  return legMs - (legDur - IMPACT_LEAD_MS);
}

/** Strike brightness. Fixed IMPACT_MS window opening at the bolt's arrival. */
export function impactPhase(legMs, legDur) {
  return shape(sinceArrival(legMs, legDur) / IMPACT_MS);
}

/** How FAR along the strike is (linear 0..1), for the ring radius. Separate
 *  from brightness: brightness rises then falls, and a radius driven by it
 *  would implode before it expands. */
export function impactProgress(legMs, legDur) {
  return Math.max(0, Math.min(1, sinceArrival(legMs, legDur) / IMPACT_MS));
}

/** Follow-up brightness on the onward strands. Its own fixed SPILL_MS window,
 *  opening after the strike has played out (IMPACT_MS + SPILL_GAP_MS past
 *  arrival) — "nachdem die Einschlagsanimation gespielt hat". */
export function spillPhase(legMs, legDur) {
  return shape((sinceArrival(legMs, legDur) - IMPACT_MS - SPILL_GAP_MS) / SPILL_MS);
}

/** How long a leg must stay alive past its bolt so the whole fixed sequence
 *  (strike → gap → follow-up) can finish. The strike opens IMPACT_LEAD_MS
 *  before the bolt ends, so the sequence's end sits that much earlier too.
 *  Constant — no slider term. */
export function tailMs() {
  return IMPACT_MS + SPILL_GAP_MS + SPILL_MS - IMPACT_LEAD_MS;
}

/** The strike itself: a tight ring that opens once, plus a small core glow.
 *
 *  `strength` already carries the chain's hop falloff, so a third-level impact
 *  is a sixth of a first-level one without this function knowing about hops.
 */
export function drawImpact(s) {
  const { ctx, x, y, r, phase, progress, strength, color, camScale, glowSprite } = s;
  if (phase <= 0) return;
  const amp = phase * strength;
  if (amp < 0.02) return; // below this it is a wasted draw call, not a subtlety

  // Ring: opens from the node and thins as it goes — driven by progress, so it
  // only ever travels outward. Half the reach of the origin's supernova ring
  // (80px): an arrival, not an announcement.
  const ringR = r + (2 + (progress ?? 0) * 34) / camScale;
  ctx.globalAlpha = Math.min(0.5, 0.62 * amp);
  ctx.lineWidth = (1.6 * phase) / camScale;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, ringR, 0, Math.PI * 2);
  ctx.stroke();

  // Core: brief brightening of the node itself, so the hit is legible even
  // when the ring has already left the node behind.
  const gr = Math.max(r * 2.1, 13 / camScale);
  ctx.globalAlpha = Math.min(0.62, 0.7 * amp);
  ctx.drawImage(glowSprite(color), x - gr, y - gr, gr * 2, gr * 2);
  ctx.globalAlpha = 1;
}

/** The spill: strands leaving the struck node that the chain does NOT use.
 *
 *  Selection is derived from the node's identity, never from the clock — the
 *  same rule the chain itself follows. A lit strand claims two memories belong
 *  together; that claim has to hold still between two flares, or the map is
 *  just twinkling at people.
 *
 *  `rnd` is the shared deterministic hash so this file needs no clock and no
 *  RNG of its own; `usedEdges` is the chain's own set, kept out so the spill
 *  cannot double-draw a strand that is already carrying the discharge.
 */
export function spillEdgesFor(nodeId, edges, usedEdges, rnd, seed) {
  const out = [];
  for (const e of edges) {
    if (out.length >= IMPACT_SPILL_MAX) break;
    if (usedEdges.has(e)) continue;
    const other = e.s?.id === nodeId ? e.t : e.t?.id === nodeId ? e.s : null;
    if (!other || other.ringHidden) continue;
    // Thin the candidates deterministically: taking simply "the first three"
    // would always pick the same corner of a hub's fan.
    if (rnd(seed + out.length * 53.7 + edges.indexOf(e) * 0.017) > 0.62) continue;
    out.push(e);
  }
  return out;
}

/** Draw one spilled strand: the connection itself, barely lit, fading with the
 *  same phase as the strike that caused it. No zigzag, no travelling head —
 *  anything with motion of its own would read as a discharge rather than as
 *  the glow around one. */
export function drawSpill(s) {
  const { ctx, e, phase, strength, color, camScale, strokeEdge } = s;
  const amp = phase * strength;
  if (amp < 0.015) return;
  ctx.globalAlpha = IMPACT_SPILL_ALPHA * amp;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 / camScale;
  strokeEdge(e);
  ctx.globalAlpha = 1;
}
