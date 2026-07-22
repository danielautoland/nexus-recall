/**
 * Verifies the impact/spill animation without a browser: the canvas is a
 * recording proxy, so every stroke, arc and alpha becomes inspectable data.
 */
import {
  impactPhase,
  impactProgress,
  drawImpact,
  drawSpill,
  spillEdgesFor,
  IMPACT_AT,
  IMPACT_SPILL_AT,
  spillPhase,
  IMPACT_SPILL_MAX,
  IMPACT_SPILL_ALPHA,
} from "../webui/js/impact.js";
import { boltRnd } from "../webui/js/bolt-styles.js";

const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!cond) process.exitCode = 1;
};

// ── recording canvas ────────────────────────────────────────────────────────
function recorder() {
  const calls = [];
  let alpha = 1;
  const ctx = {
    get globalAlpha() { return alpha; },
    set globalAlpha(v) { alpha = v; },
    lineWidth: 1,
    strokeStyle: "",
    beginPath: () => calls.push({ op: "beginPath" }),
    arc: (x, y, r) => calls.push({ op: "arc", x, y, r, alpha }),
    stroke: () => calls.push({ op: "stroke", alpha }),
    drawImage: (_s, x, y, w) => calls.push({ op: "drawImage", x, y, w, alpha }),
    moveTo: () => {}, lineTo: () => {},
  };
  return { ctx, calls };
}
const glowSprite = () => ({ sprite: true });

// ── 1. phase curve ──────────────────────────────────────────────────────────
ok("phase is 0 while the bolt is still travelling", impactPhase(0) === 0 && impactPhase(IMPACT_AT) === 0);
ok("phase is 0 once the leg is over", impactPhase(1) === 0 && impactPhase(1.2) === 0);
const peak = [...Array(101).keys()].map((i) => ({ t: i / 100, p: impactPhase(i / 100) }))
  .reduce((a, b) => (b.p > a.p ? b : a));
ok("phase peaks inside the arrival window", peak.p > 0.9 && peak.t > IMPACT_AT && peak.t < 1,
   `peak ${peak.p.toFixed(2)} at t=${peak.t}`);
// rises faster than it falls — a strike, not a breath
const rise = peak.t - IMPACT_AT, fall = 1 - peak.t;
ok("rises fast, decays slow", fall > rise * 1.5, `rise ${rise.toFixed(3)} vs fall ${fall.toFixed(3)}`);

// ── 1b. cause before consequence ────────────────────────────────────────────
// The strike lands first, the neighbourhood answers after. Sharing one phase
// (which is how it started) flattens the two into a single event.
ok("the spill starts after the strike", IMPACT_SPILL_AT > IMPACT_AT,
   `spill ${IMPACT_SPILL_AT} > impact ${IMPACT_AT}`);
const firstImpact = [...Array(200).keys()].map((i) => i / 200).find((t) => impactPhase(t) > 0);
const firstSpill = [...Array(200).keys()].map((i) => i / 200).find((t) => spillPhase(t) > 0);
ok("nothing spills before the strike is visible", firstSpill > firstImpact,
   `impact from t=${firstImpact.toFixed(3)}, spill from t=${firstSpill.toFixed(3)}`);
ok("both are done by the end of the leg", impactPhase(0.999) >= 0 && spillPhase(1) === 0);
// and the strike itself must not sit at the very end of the travel
ok("the strike is not late in the leg", IMPACT_AT < 0.5, `IMPACT_AT ${IMPACT_AT}`);

// ── 2. the impact stays under the origin flare ──────────────────────────────
// origin supernova: ring alpha 0.75, halo up to 0.9, ring reach 80px
const { ctx, calls } = recorder();
drawImpact({ ctx, x: 0, y: 0, r: 4, phase: 1, strength: 1, color: "#fff", camScale: 1, glowSprite });
const alphasOf = (cs) => cs.filter((c) => typeof c.alpha === "number").map((c) => c.alpha);
const maxAlpha = Math.max(...alphasOf(calls));
ok("impact never outshines the origin flare", maxAlpha <= 0.65, `max alpha ${maxAlpha.toFixed(2)}`);
const ring = calls.find((c) => c.op === "arc");
ok("impact ring stays well inside the supernova's reach", ring.r < 45, `reach ${ring.r.toFixed(1)}px vs 80px`);

// ── 2b. the ring only ever travels OUTWARD ──────────────────────────────────
// The bug this pins: sizing the ring off `phase` (which rises then falls) makes
// it start wide, collapse inward while the strike brightens, and only then
// expand. Radius must follow progress, which is monotonic.
const radii = [];
for (let i = 0; i <= 40; i++) {
  const t = IMPACT_AT + ((1 - IMPACT_AT) * i) / 40;
  const r = recorder();
  drawImpact({
    ctx: r.ctx, x: 0, y: 0, r: 4, phase: 1 /* forced: isolate geometry */,
    progress: impactProgress(t), strength: 1, color: "#fff", camScale: 1, glowSprite,
  });
  const arc = r.calls.find((c) => c.op === "arc");
  if (arc) radii.push(arc.r);
}
const monotonic = radii.every((v, i) => i === 0 || v >= radii[i - 1] - 1e-9);
ok("impact ring never contracts", monotonic,
   `${radii[0].toFixed(1)}px → ${radii[radii.length - 1].toFixed(1)}px`);
ok("impact ring actually travels", radii[radii.length - 1] > radii[0] * 2);
ok("progress is monotonic across the window",
   [...Array(50).keys()].every((i, _, a) => {
     const t0 = i / 49, t1 = (i + 1) / 49;
     return impactProgress(t1) >= impactProgress(t0);
   }));

// ── 3. hop falloff carries into the impact ──────────────────────────────────
const at = (strength) => {
  const r = recorder();
  drawImpact({ ctx: r.ctx, x: 0, y: 0, r: 4, phase: 1, strength, color: "#fff", camScale: 1, glowSprite });
  return Math.max(0, ...alphasOf(r.calls));
};
const [a1, a2, a3] = [at(1), at(0.22), at(0.22 ** 2)];
ok("deeper hops strike dimmer", a1 > a2 && a2 > a3, `${a1.toFixed(2)} > ${a2.toFixed(2)} > ${a3.toFixed(2)}`);
ok("third-level impact is nearly gone", a3 < 0.06, `${a3.toFixed(3)}`);
ok("a vanishing impact draws nothing at all", at(0.001) === 0);

// ── 4. spill is faint and finite ────────────────────────────────────────────
const spillCalls = [];
const strokeEdge = (e) => spillCalls.push({ e, alpha: sctx.globalAlpha });
const sRec = recorder(); const sctx = sRec.ctx;
drawSpill({ ctx: sctx, e: { id: "e1" }, phase: 1, strength: 1, color: "#fff", camScale: 1, strokeEdge });
ok("spill peaks at the configured whisper", Math.abs(spillCalls[0].alpha - IMPACT_SPILL_ALPHA) < 1e-9,
   `${spillCalls[0].alpha}`);
ok("spill is far below the impact that causes it", IMPACT_SPILL_ALPHA < maxAlpha / 2.5);
spillCalls.length = 0;
drawSpill({ ctx: sctx, e: { id: "e2" }, phase: 0.01, strength: 0.05, color: "#fff", camScale: 1, strokeEdge });
ok("an invisible spill is skipped, not drawn", spillCalls.length === 0);

// ── 5. selection: deterministic, bounded, never the chain's own strands ─────
const node = (id) => ({ id, ringHidden: false });
const nodes = [...Array(40).keys()].map((i) => node("n" + i));
const hub = node("hub");
const edges = nodes.map((n) => ({ s: hub, t: n }));
const used = new Set([edges[0], edges[1]]);
const seedFor = (id) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100000; return h; };

const pick1 = spillEdgesFor("hub", edges, used, boltRnd, seedFor("hub"));
const pick2 = spillEdgesFor("hub", edges, used, boltRnd, seedFor("hub"));
ok("same node picks the same strands every flare", JSON.stringify(pick1) === JSON.stringify(pick2));
ok("spill is capped", pick1.length <= IMPACT_SPILL_MAX, `${pick1.length} ≤ ${IMPACT_SPILL_MAX}`);
ok("spill never re-uses a strand the chain is already using",
   pick1.every((e) => !used.has(e)));
const other = spillEdgesFor("hub", edges, used, boltRnd, seedFor("different-memory"));
ok("a different identity picks a different fan", JSON.stringify(other) !== JSON.stringify(pick1));

// hidden neighbours are skipped
const hidden = edges.map((e, i) => (i % 2 ? { ...e, t: { ...e.t, ringHidden: true } } : e));
const pickH = spillEdgesFor("hub", hidden, new Set(), boltRnd, seedFor("hub"));
ok("drilled-away neighbours are never lit", pickH.every((e) => !e.t.ringHidden && !e.s.ringHidden));

// a node with no free strands spills nothing
ok("no free strand → no spill", spillEdgesFor("hub", edges, new Set(edges), boltRnd, 1).length === 0);
