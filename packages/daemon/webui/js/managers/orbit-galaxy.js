/** Galactic placement for the Mindspace view (#217 follow-up) — pure layout
 *  math, no view state. The user cloud sits at the origin as the black-hole
 *  core; every other cloud gets an orbit {r, phase, omega, y}. Ring packing
 *  is greedy by circumference; ring order encodes the distance option —
 *  woven (edge share to the user's memories + usage heat) or balanced (by
 *  size). Intake clouds always take the outermost ring: not yet woven into
 *  the user's life, they visibly migrate inward through adoption.
 *
 *  Also home of the orbit math primitives the view shares (GOLDEN, rnd,
 *  discRFor) — they have no DOM/state dependencies either. */

import { HEAT_MIN_WEIGHT } from "../graph-data.js";

export const GOLDEN = 2.399963; // radians — Fibonacci / phyllotaxis step
export const DWARF_MAX = 4;

// localStorage keys + drift pacing for the galactic mode
export const MODE_KEY = "bastra-vault-map-mindspace-mode";
export const DIST_KEY = "bastra-vault-map-mindspace-distance";
export const DRIFT_KEY = "bastra-vault-map-mindspace-drift";
export const DRIFT_RESUME_MS = 2500; // drift pauses on interaction, resumes after
const ORBIT_OMEGA = 0.014; // rad/s on the innermost cloud ring — calm drive

/** Deterministic pseudo-random in [0,1) from an index — stable per session. */
export const rnd = (i, salt = 1) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Disc radius from member count — shared by both placement modes. */
export const discRFor = (count) =>
  count <= DWARF_MAX ? Math.max(30, Math.sqrt(count) * 18) : Math.max(60, Math.sqrt(count) * 30);

/** @param {Array<[string, object[]]>} entries  cluster key → member nodes
 *  @param {object[]} edges                     sim edges ({s, t} node refs)
 *  @param {"woven"|"balanced"} distanceMode
 *  @returns {{placement: Map, hole: {r: number}, rings: number[]}} — placement
 *  maps key → {center, orbit, spinBoost}; center is the LIVE object the view
 *  mutates per frame for orbital drift. */
export function galaxyPlacement(entries, edges, distanceMode) {
  const placement = new Map();
  const userEntry = entries.find(([key]) => key === "user");
  const userDiscR = discRFor(userEntry ? userEntry[1].length : 0);
  if (userEntry) {
    placement.set("user", { center: { px: 0, py: 0, pz: 0 }, orbit: null, spinBoost: 2.4 });
  }
  const hole = { r: Math.max(userDiscR * 0.5, 34) };

  // weave: how much of a cloud's edge mass runs to the user's memories
  const userIds = new Set((userEntry?.[1] ?? []).map((n) => n.id));
  const clusterOfN = (n) => n.baseCluster ?? n.cluster;
  const toUser = new Map();
  for (const e of edges) {
    const sUser = userIds.has(e.s.id);
    const tUser = userIds.has(e.t.id);
    if (sUser === tUser) continue; // both or neither — no user link
    const other = sUser ? e.t : e.s;
    const key = clusterOfN(other);
    toUser.set(key, (toUser.get(key) ?? 0) + 1);
  }

  const isIntake = (key, members) => members[0]?.group === "intake" || / \(import\)$/.test(key);
  const scored = entries
    .filter(([key]) => key !== "user")
    .map(([key, members], i) => {
      // #227: dieselbe Schwelle wie der Halo. Sonst zieht ein Knoten, der
      // sichtbar NICHT als heiß gilt, trotzdem still an der Anordnung.
      const heatAvg =
        members.reduce((s, n) => s + ((n.reach?.weight ?? 0) >= HEAT_MIN_WEIGHT ? (n.heat ?? 0) : 0), 0) /
        members.length;
      const weave = (toUser.get(key) ?? 0) / members.length + heatAvg * 0.5;
      return { key, members, i, weave, intake: isIntake(key, members), discR: discRFor(members.length) };
    });
  scored.sort((a, b) => {
    if (a.intake !== b.intake) return a.intake ? 1 : -1; // intake last = outermost
    return distanceMode === "woven" ? b.weave - a.weave : b.members.length - a.members.length;
  });

  // greedy ring packing: fill a ring while the arcs fit, then step outward
  const rings = [];
  let ringR = Math.max(userDiscR * 2.4, 150) + 130;
  let ring = [];
  let ringMax = 0;
  const flush = () => {
    if (!ring.length) return;
    rings.push(ringR);
    const total = ring.reduce((s, c) => s + c.need, 0);
    let angle = rings.length * GOLDEN * 1.3; // stagger ring starts
    const omega = ORBIT_OMEGA / Math.pow(ringR / (rings[0] ?? ringR), 0.85);
    for (const c of ring) {
      const span = (c.need / total) * Math.PI * 2;
      const phase = angle + span / 2;
      const y = (rnd(c.i, 211) - 0.5) * ringR * 0.16; // slight plane wobble
      const center = {
        px: Math.cos(phase) * ringR,
        py: y,
        pz: Math.sin(phase) * ringR,
      };
      placement.set(c.key, {
        center,
        orbit: { r: ringR, phase, omega, y },
        spinBoost: 1,
      });
      angle += span;
    }
    ringR += ringMax * 1.4 + 170;
    ring = [];
    ringMax = 0;
  };
  for (const c of scored) {
    c.need = c.discR * 2.6 + 120;
    const used = ring.reduce((s, x) => s + x.need, 0);
    if (ring.length && used + c.need > Math.PI * 2 * ringR) flush();
    ring.push(c);
    ringMax = Math.max(ringMax, c.discR);
  }
  flush();
  return { placement, hole, rings };
}
