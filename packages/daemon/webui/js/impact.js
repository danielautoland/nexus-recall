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

/** When on a leg's own 0..1 timeline the discharge counts as arrived.
 *
 *  Tuned down from 0.62: keying it to `pulse`, whose head only reaches the far
 *  end at t ≈ 0.87, made the strike feel like it came after the event rather
 *  than being it. The default style `bolt` puts its zigzag across the whole
 *  strand immediately, so the eye is already at the far node long before the
 *  slowest style gets there. */
export const IMPACT_AT = 0.38;

/** When the spilled strands pick up, on the same 0..1 leg timeline.
 *
 *  Deliberately after IMPACT_AT: the strike lands, and only then does the
 *  neighbourhood answer. Firing both on one phase — which is what it did at
 *  first — collapses cause and consequence into a single flat event. */
export const IMPACT_SPILL_AT = 0.56;

/** How many of the target's other strands glow along. Three is the most that
 *  still reads as "a couple"; beyond that a hub turns into a starburst. */
export const IMPACT_SPILL_MAX = 3;

/** Peak opacity of a spilled strand. Low on purpose — this is the quietest
 *  mark on the map, and it should stay that way. */
export const IMPACT_SPILL_ALPHA = 0.17;

/** Ceiling for the spill selection across one chain, so a dense galaxy cannot
 *  turn a single flare into hundreds of extra strokes per frame. */
export const IMPACT_SPILL_BUDGET = 18;

/** Where the rise finishes and the decay takes over, on the window's own 0..1
 *  axis. The quarter is what makes it read as a strike rather than a breath. */
const IMPACT_RISE = 0.25;

/** 0 → 1 → 0 over the arrival window: rises fast, falls slow. Returns 0 before
 *  the discharge has arrived, which is what keeps the strike off the origin.
 *
 *  Normalised so the peak really is 1: without the divisor the curve tops out
 *  at 1 - IMPACT_RISE, and every brightness downstream would silently inherit
 *  that factor — the strike would be dimmer than the constants claim, for no
 *  reason anyone could find later. */
export function impactPhase(t) {
  if (t <= IMPACT_AT || t >= 1) return 0;
  const u = (t - IMPACT_AT) / (1 - IMPACT_AT);
  return (Math.min(u / IMPACT_RISE, 1) * (1 - u)) / (1 - IMPACT_RISE);
}

/** Linear 0..1 across the same window — how FAR along the strike is, as
 *  opposed to how bright.
 *
 *  These have to be two different numbers. Brightness rises and then falls, so
 *  anything geometric driven by it runs backwards for the first quarter: a ring
 *  sized off the phase starts wide, collapses inward as the strike brightens,
 *  and only then expands. An impact that implodes first is not a subtle bug —
 *  it is the opposite of the gesture. */
export function impactProgress(t) {
  if (t <= IMPACT_AT) return 0;
  if (t >= 1) return 1;
  return (t - IMPACT_AT) / (1 - IMPACT_AT);
}

/** Brightness of the spilled strands — same shape as impactPhase, but starting
 *  later, so the glow trails the strike instead of sharing its instant. */
export function spillPhase(t) {
  if (t <= IMPACT_SPILL_AT || t >= 1) return 0;
  const u = (t - IMPACT_SPILL_AT) / (1 - IMPACT_SPILL_AT);
  return (Math.min(u / IMPACT_RISE, 1) * (1 - u)) / (1 - IMPACT_RISE);
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
