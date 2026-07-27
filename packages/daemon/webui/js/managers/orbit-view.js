/** Orbit view (#216), v5 — the universe, rebuilt on audit findings + canvas
 *  best practices (see the audit/research pass, 2026-07-18):
 *
 *  Structure (unchanged in spirit):
 *    galaxies (areas) spread irregularly through a volume, tilted spiral
 *    discs with slow self-rotation · dwarf galaxies for small areas · some
 *    galaxies inside animated nebulae · subgalaxies (sub-areas) on satellite
 *    rings · solar systems where a hub memory carries orbiting satellites ·
 *    two star populations (background shell + intergalactic drifters) ·
 *    twinkle, a shooting star, and live supernova bursts.
 *
 *  The audit fixes baked in:
 *    - build() groups by n.baseCluster: the structure mode can never poison
 *      the universe again (spawnBurst used to build it under "blocks")
 *    - one shared depth scale + front fade for nodes AND decor — no more
 *      hard perspective clamp freezing the near side
 *    - enter() computes flight targets at landing time (+0.95 s) and stamps
 *      depth attributes immediately — no pop when the flight ends
 *    - galaxy labels use screen-px floors like every other text
 *    - all glows draw from pre-rendered sprites (glowSprite) in one additive
 *      batch (theme.flowBlend) — the per-frame gradient storm is gone
 *    - viewport culling for stars, galaxies, systems; orbit rings at 17 pts
 *    - bursts dim with depth; decor fades in with the entry flight
 *    - planet speed calmed (OMEGA) so hover targets stay catchable
 *
 *  Navigation: drag rotates (around the universe's own center), shift-drag
 *  pans, scroll zooms. Hover/click keep working — real screen positions land
 *  in n.x/n.y every frame.
 *
 *  @param {object} deps
 *  @param {object} deps.sim              simulation (nodes, edges)
 *  @param {object} deps.renderer         canvas renderer (decor, drawOrder, camera)
 *  @param {() => object} deps.getInteractions  drag delegate for rotation
 *  @param {() => Map} deps.getHues       active cluster→hue map
 *  @param {() => [string, string]} deps.getSatLight  theme HSL parts */

import { clusterColor, glowSprite } from "../graph-data.js";
// galactic mode (#217 follow-up): the user cloud as the rotating center —
// opt-in layout, pure placement math lives in orbit-galaxy.js
import {
  GOLDEN,
  DWARF_MAX,
  MODE_KEY,
  DIST_KEY,
  DRIFT_KEY,
  DRIFT_RESUME_MS,
  rnd,
  discRFor,
  galaxyPlacement,
} from "./orbit-galaxy.js";
import { createOrbitDecor } from "./orbit-decor.js";

const $ = (sel) => document.querySelector(sel);
const PITCH_MAX = 1.25;
const SUN_DEGREE = 5;
const PLANET_DEGREE = 3;
const MAX_PLANETS = 7;
const ORBIT_BASE = 16;
const ORBIT_STEP = 10;
const OMEGA = 0.35; // rad/s at the innermost ring — calm, hover-catchable
const DISC_SPIN = 0.032;

/** Seconds a newborn-memory star stays highlighted (canvas + card agree). */
export const BURST_LIFE = 120;

/** Supernova primitive — flash → shockwave ring → pulsing newborn star with
 *  a live seconds readout. Screen-px floors on every size; `dim` lets the
 *  universe view recede far-side bursts. */
export function drawBurstAt(ctx, camera, theme, x, y, scale, age, dim = 1) {
  const fadeOut = (age > BURST_LIFE - 8 ? Math.max((BURST_LIFE - age) / 8, 0) : 1) * dim;
  if (fadeOut <= 0.02) return;
  const S = (world, minPx) => Math.max(world * scale, minPx / camera.scale);
  if (age < 2.2) {
    const t = age / 2.2;
    const ringR = 4 / camera.scale + t * S(90, 150);
    ctx.globalAlpha = 0.55 * (1 - t) * dim;
    ctx.lineWidth = 2 / camera.scale;
    ctx.strokeStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, Math.PI * 2);
    ctx.stroke();
    const flashR = S(26 - t * 14, 44 - t * 20);
    ctx.globalAlpha = 0.9 * (1 - t * 0.4) * dim;
    ctx.drawImage(glowSprite(theme.accent, theme.label), x - flashR, y - flashR, flashR * 2, flashR * 2);
  }
  if (age >= 2.2) {
    const k = (age % 3) / 3;
    const br = k * S(60, 110);
    ctx.globalAlpha = 0.3 * (1 - k) * fadeOut;
    ctx.lineWidth = 1.4 / camera.scale;
    ctx.strokeStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(x, y, br, 0, Math.PI * 2);
    ctx.stroke();
  }
  const pulse = 1 + 0.22 * Math.sin(age * 3.1);
  const starR = S(7, 10) * pulse;
  ctx.globalAlpha = 0.85 * fadeOut;
  ctx.drawImage(glowSprite(theme.accent, theme.label), x - starR * 2.4, y - starR * 2.4, starR * 4.8, starR * 4.8);
  ctx.globalAlpha = 0.9 * fadeOut;
  ctx.lineWidth = 1.2 / camera.scale;
  ctx.strokeStyle = theme.accent;
  const g = starR * 2.2;
  ctx.beginPath();
  ctx.moveTo(x - g, y);
  ctx.lineTo(x + g, y);
  ctx.moveTo(x, y - g);
  ctx.lineTo(x, y + g);
  ctx.stroke();
  const fontPx = Math.max(10 * scale, 11 / camera.scale);
  ctx.font = `700 ${fontPx}px "SF Mono", ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.lineWidth = 3 / camera.scale;
  ctx.strokeStyle = theme.labelHalo;
  const label = `✦ ${Math.floor(age)}s`;
  ctx.strokeText(label, x, y + starR * 2.4 + fontPx);
  ctx.fillStyle = theme.accent;
  ctx.fillText(label, x, y + starR * 2.4 + fontPx);
  ctx.globalAlpha = 1;
}

export function createOrbitView(deps) {
  let universe = null;
  let stars = null;
  let R = 0;
  let yaw = 0.7;
  let pitch = -0.35;
  let enterAt = 0; // decor fades in with the entry flight
  const bursts = new Map(); // id → {world, born, entry}

  // galactic mode state — persisted; "universe" (heute) bleibt der Default
  let mode = localStorage.getItem(MODE_KEY) === "galaxy" ? "galaxy" : "universe";
  let distanceMode = localStorage.getItem(DIST_KEY) === "balanced" ? "balanced" : "woven";
  let drift = localStorage.getItem(DRIFT_KEY) !== "off";
  let hole = null; // { r } — the black-hole core visual, galaxy mode only
  let orbitRings = []; // distinct ring radii for the faint orbit guides
  let orbitT = 0; // drift clock: accumulates ONLY while drifting (no resume-jump)
  let lastTick = 0;
  let lastInteract = 0; // drift pauses while the user navigates
  const markInteract = () => {
    lastInteract = performance.now();
  };
  addEventListener("pointerdown", markInteract, true);
  addEventListener("wheel", markInteract, { passive: true, capture: true });

  // ── linear algebra bits ────────────────────────────────────────────
  const add = (a, b) => ({ px: a.px + b.px, py: a.py + b.py, pz: a.pz + b.pz });
  const scale3 = (a, s) => ({ px: a.px * s, py: a.py * s, pz: a.pz * s });
  const cross = (a, b) => ({
    px: a.py * b.pz - a.pz * b.py,
    py: a.pz * b.px - a.px * b.pz,
    pz: a.px * b.py - a.py * b.px,
  });
  const norm = (a) => {
    const l = Math.hypot(a.px, a.py, a.pz) || 1;
    return { px: a.px / l, py: a.py / l, pz: a.pz / l };
  };
  const inPlane = (center, basis, x, y, z = 0) =>
    add(add(center, add(scale3(basis.u, x), scale3(basis.v, y))), scale3(basis.w, z));

  function discBasis(seed) {
    const a = rnd(seed, 3) * Math.PI * 2;
    const b = (rnd(seed, 7) - 0.5) * 1.6;
    const w = { px: Math.sin(b) * Math.cos(a), py: Math.cos(b), pz: Math.sin(b) * Math.sin(a) };
    const ref = Math.abs(w.py) < 0.9 ? { px: 0, py: 1, pz: 0 } : { px: 1, py: 0, pz: 0 };
    const u = norm(cross(ref, w));
    const v = cross(w, u);
    return { u, v, w };
  }

  // ── universe construction ──────────────────────────────────────────
  function build() {
    universe = { disc: new Map(), planets: new Map(), galaxies: [], systems: [] };

    const adj = new Map();
    const link = (a, b) => {
      const l = adj.get(a.id) ?? [];
      l.push(b);
      adj.set(a.id, l);
    };
    for (const e of deps.sim.edges) {
      link(e.s, e.t);
      link(e.t, e.s);
    }

    // ALWAYS group by the stable fine layer (baseCluster) — n.cluster follows
    // the active structure mode, and a build under "blocks" (e.g. triggered
    // by a live update while in ring view) used to poison the whole universe
    const clusterOf = (n) => n.baseCluster ?? n.cluster;
    const groups = new Map();
    for (const n of deps.sim.nodes) {
      const key = clusterOf(n);
      const l = groups.get(key) ?? [];
      l.push(n);
      groups.set(key, l);
    }
    const entries = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    R = Math.max(520, Math.cbrt(deps.sim.nodes.length) * 190);

    // galactic mode: radial placement around the user core replaces the
    // volume spread; everything downstream (discs, sub rings, systems,
    // bursts) follows the SAME center objects, which tick() then orbits.
    const galactic = mode === "galaxy" ? galaxyPlacement(entries, deps.sim.edges, distanceMode) : null;
    if (galactic) {
      hole = galactic.hole;
      orbitRings = galactic.rings;
      orbitRings.forEach((r) => (R = Math.max(R, r * 0.82)));
    } else {
      hole = null;
      orbitRings = [];
    }

    const VOL = { x: R * 1.6, y: R * 0.8, z: R * 1.4 };
    const sampleVolume = (seed) => {
      const u = rnd(seed, 61) * Math.PI * 2;
      const v = Math.acos(2 * rnd(seed, 67) - 1);
      const rr3 = Math.cbrt(rnd(seed, 71));
      return {
        px: Math.sin(v) * Math.cos(u) * rr3 * VOL.x,
        py: Math.cos(v) * rr3 * VOL.y,
        pz: Math.sin(v) * Math.sin(u) * rr3 * VOL.z,
      };
    };
    const dist3 = (a, b) => Math.hypot(a.px - b.px, a.py - b.py, a.pz - b.pz);
    const placedCenters = [];

    entries.forEach(([key, members], ci) => {
      let center = null;
      let orbit = null;
      let spinBoost = 1;
      if (galactic) {
        const p = galactic.placement.get(key);
        center = p.center;
        orbit = p.orbit;
        spinBoost = p.spinBoost;
      } else {
        let bestScore = -1;
        for (let k = 0; k < 24; k++) {
          const cand = sampleVolume(ci * 131 + k);
          const score = placedCenters.length
            ? Math.min(...placedCenters.map((p) => dist3(p, cand)))
            : dist3(cand, { px: 0, py: 0, pz: 0 }) + VOL.x;
          if (score > bestScore) {
            bestScore = score;
            center = cand;
          }
        }
        placedCenters.push(center);
      }

      const dwarf = members.length <= DWARF_MAX;
      const discR = discRFor(members.length);
      const basis = discBasis(ci + 1);
      const spin = DISC_SPIN * (0.4 + rnd(ci, 89) * 0.6) * (rnd(ci, 91) > 0.5 ? 1 : -1) * spinBoost;
      const nebula = !dwarf && rnd(ci, 95) > 0.62
        ? Array.from({ length: 3 }, (_, bi) => ({
            ox: (rnd(ci * 7 + bi, 101) - 0.5) * discR * 1.6,
            oy: (rnd(ci * 7 + bi, 103) - 0.5) * discR * 1.6,
            r: discR * (0.7 + rnd(ci * 7 + bi, 107) * 0.9),
            phase: rnd(ci * 7 + bi, 109) * Math.PI * 2,
            drift: 0.05 + rnd(ci * 7 + bi, 113) * 0.1,
          }))
        : null;
      universe.galaxies.push({
        key, center, orbit, basis, r: discR, count: members.length,
        dwarf, nebula, spin, phase: rnd(ci, 151) * Math.PI * 2,
        sx: 0, sy: 0, d: 0, scale: 1,
      });

      const subs = new Map();
      for (const n of members) {
        const s = n.sub && n.sub !== "general" ? n.sub : "";
        const l = subs.get(s) ?? [];
        l.push(n);
        subs.set(s, l);
      }
      const subKeys = [...subs.keys()].filter((s) => s !== "" && subs.get(s).length >= 3);
      const coreMembers = members.filter((n) => !subKeys.includes(n.sub));
      layoutDisc(coreMembers, center, basis, discR, adj, ci * 97 + 1, spin, dwarf);
      subKeys.forEach((sk, si) => {
        const subMembers = subs.get(sk);
        const subR = Math.max(34, Math.sqrt(subMembers.length) * 18);
        const ring = {
          parent: center,
          ringR: discR * 1.55 + si * 24,
          phase: si * GOLDEN + rnd(ci, 11) * Math.PI * 2,
          omega: 0.006 * (0.5 + rnd(ci * 7 + si, 157) * 0.8) * (rnd(ci * 7 + si, 163) > 0.5 ? 1 : -1),
          zoff: (rnd(si + ci, 13) - 0.5) * discR * 0.4,
        };
        layoutDisc(subMembers, null, basis, subR, adj, ci * 97 + si * 13 + 2, spin, false, ring);
      });
    });

    stars = [];
    for (let i = 0; i < 480; i++) {
      const sy = 1 - (2 * (i + 0.5)) / 480;
      const sr = Math.sqrt(Math.max(0, 1 - sy * sy));
      const sa = i * GOLDEN * 1.7;
      const shell = R * (2.4 + rnd(i, 17) * 1.2);
      stars.push({
        px: Math.cos(sa) * sr * shell, py: sy * shell, pz: Math.sin(sa) * sr * shell,
        size: 0.5 + rnd(i, 19) * 1.1,
        alpha: 0.06 + rnd(i, 23) * 0.26,
        bright: rnd(i, 29) > 0.97,
        tw: rnd(i, 31) * Math.PI * 2,
      });
    }
    for (let i = 0; i < 260; i++) {
      const p = sampleVolume(i * 977 + 5);
      stars.push({
        px: p.px * 1.15, py: p.py * 1.15, pz: p.pz * 1.15,
        size: 0.7 + rnd(i, 73) * 1.4,
        alpha: 0.1 + rnd(i, 79) * 0.3,
        bright: rnd(i, 83) > 0.94,
        tw: rnd(i, 87) * Math.PI * 2,
      });
    }
  }

  function layoutDisc(members, center, basis, discR, adj, seed, spin, dwarf, ring = null) {
    if (!members.length) return;
    const claimed = new Set();
    const memberSet = new Set(members);

    const suns = dwarf
      ? []
      : members
          .filter((n) => (n.degree ?? 0) >= SUN_DEGREE)
          .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0))
          .slice(0, Math.max(1, Math.floor(Math.sqrt(members.length) / 1.6)));

    for (const sun of suns) {
      const sats = (adj.get(sun.id) ?? [])
        .filter((m) => memberSet.has(m) && !claimed.has(m.id) && m !== sun && (m.degree ?? 0) <= PLANET_DEGREE)
        .slice(0, MAX_PLANETS);
      if (sats.length < 2) continue;
      claimed.add(sun.id);
      const local = spiralLocal(discR, claimed.size * 7 + seed, 0.25 + rnd(seed + claimed.size, 31) * 0.55, dwarf, spin);
      universe.disc.set(sun.id, { center, ring, basis, ...local, spin });
      const rings = [];
      sats.forEach((p, pi) => {
        claimed.add(p.id);
        const orbitR = ORBIT_BASE + pi * ORBIT_STEP;
        rings.push(orbitR);
        universe.planets.set(p.id, {
          sunId: sun.id,
          basis,
          orbitR,
          phase: pi * GOLDEN + rnd(seed + pi, 37) * Math.PI * 2,
          omega: (OMEGA / Math.pow(orbitR / ORBIT_BASE, 1.5)) * (rnd(seed + pi, 41) > 0.5 ? 1 : -1),
        });
      });
      universe.systems.push({ sunId: sun.id, basis, rings, pulse: rnd(seed, 167) * Math.PI * 2, sunWorld: null, sx: 0, sy: 0, d: 0, scale: 1 });
    }

    const field = members.filter((n) => !claimed.has(n.id));
    field.forEach((n, i) => {
      const t = (i + 0.5) / field.length;
      const local = spiralLocal(discR, i + seed, t, dwarf, spin);
      universe.disc.set(n.id, { center, ring, basis, ...local, spin });
    });
  }

  /** #283 — the arm winding has to be mirrored with the disc's spin sign.
   *
   *  Real spiral galaxies have TRAILING arms: the outer tips lag behind the
   *  rotation, they never lead it. So the winding and the rotation must move
   *  the angle in OPPOSITE directions — same sign is "leading arms", which
   *  reads as the galaxy turning backwards.
   *
   *  The winding used to be a fixed `+t * 3.6` for every disc while `spin`
   *  (:254) is a per-cluster coin flip, so roughly half of any vault's
   *  galaxies rendered leading arms. Forcing one spin sign would fix the
   *  physics and break the variety — real galaxies appear both ways from our
   *  viewpoint — so the sign stays random and the winding follows it.
   *
   *  `worldPos` rotates by `+spin * tSec` (counter-clockwise for spin > 0), so
   *  trailing means the angle must DECREASE with radius there: winding = -sign(spin).
   */
  function spiralLocal(discR, i, t, dwarf, spin) {
    if (dwarf) {
      // Phyllotaxis scatter, no arms — nothing to contradict the rotation.
      const angle = i * GOLDEN;
      const radius = discR * Math.sqrt(t) * (0.8 + rnd(i, 59) * 0.3);
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: (rnd(i, 53) - 0.5) * discR * 0.3 };
    }
    const windingSign = spin < 0 ? 1 : -1;
    const arm = i % 2;
    const angle = windingSign * t * 3.6 + arm * Math.PI + (rnd(i, 43) - 0.5) * 0.65;
    const radius = discR * (0.12 + 0.88 * t) * (0.86 + rnd(i, 47) * 0.28);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: (rnd(i, 53) - 0.5) * discR * 0.22 };
  }

  // ── world positions (time-dependent) ───────────────────────────────
  function worldPos(id, tSec) {
    const orbit = universe.planets.get(id);
    if (orbit) {
      const sunWorld = worldPos(orbit.sunId, tSec);
      if (!sunWorld) return null;
      const a = orbit.phase + orbit.omega * tSec;
      return inPlane(sunWorld, orbit.basis, Math.cos(a) * orbit.orbitR, Math.sin(a) * orbit.orbitR);
    }
    const p = universe.disc.get(id);
    if (!p) return null;
    const center = p.ring
      ? inPlane(
          p.ring.parent,
          p.basis,
          Math.cos(p.ring.phase + p.ring.omega * tSec) * p.ring.ringR,
          Math.sin(p.ring.phase + p.ring.omega * tSec) * p.ring.ringR,
          p.ring.zoff,
        )
      : p.center;
    const a = p.spin * tSec;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return inPlane(center, p.basis, p.x * cos - p.y * sin, p.x * sin + p.y * cos, p.z);
  }

  // ── projection + ONE depth model for nodes and decor ───────────────
  function project(p, trig, cx, cy) {
    const x1 = p.px * trig.cosY + p.pz * trig.sinY;
    const z1 = -p.px * trig.sinY + p.pz * trig.cosY;
    const y2 = p.py * trig.cosP - z1 * trig.sinP;
    const z2 = p.py * trig.sinP + z1 * trig.cosP;
    const d = z2 / (R * 1.35);
    const persp = 1 / (1 + Math.max(d, -1.2) * 0.42);
    return { x: cx + x1 * persp, y: cy + y2 * persp, d, scale: persp };
  }

  /** Shared clamps: nodes and decor scale identically, and instead of the
   *  perspective clamp freezing the near side, everything closer than
   *  d≈-1.1 dissolves (front fade). */
  const depthScale = (pr) => Math.min(Math.max(pr.scale, 0.55), 1.5);
  const frontFade = (d) => (d < -1.1 ? Math.max(0, (d + 1.35) / 0.25) : 1);
  const depthFade = (d) => Math.min(Math.max(1 - (d + 1) * 0.4, 0.25), 1) * frontFade(d);

  const trigNow = () => ({
    cosY: Math.cos(yaw),
    sinY: Math.sin(yaw),
    cosP: Math.cos(pitch),
    sinP: Math.sin(pitch),
  });

  /** Visible world rect (with margin) for cheap offscreen culling. */
  function viewRect(margin) {
    const cam = deps.renderer.camera;
    const l = -cam.x / cam.scale - margin;
    const t = -cam.y / cam.scale - margin;
    return { l, t, r: l + innerWidth / cam.scale + margin * 2, b: t + innerHeight / cam.scale + margin * 2 };
  }
  const inView = (v, x, y) => x >= v.l && x <= v.r && y >= v.t && y <= v.b;

  function apply(tSec, intoMap = null) {
    if (!universe) return;
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    const trig = trigNow();
    for (const n of deps.sim.nodes) {
      const p = worldPos(n.id, tSec);
      if (!p) continue;
      const pr = project(p, trig, cx, cy);
      if (intoMap) {
        intoMap.set(n.id, { x: pr.x, y: pr.y });
      } else {
        n.x = pr.x;
        n.y = pr.y;
      }
      // depth attributes are stamped in BOTH paths, so the entry flight
      // already renders true sizes/alphas — no snap on landing
      n.orbitDepth = pr.d;
      n.ringScale = depthScale(pr);
      n.ringFade = Math.min(Math.max(1 - (pr.d + 1) * 0.4, 0.3), 1) * frontFade(pr.d);
    }
    for (const g of universe.galaxies) {
      const pr = project(g.center, trig, cx, cy);
      g.sx = pr.x;
      g.sy = pr.y;
      g.d = pr.d;
      g.scale = depthScale(pr);
      // UNclamped perspective — g.scale is clamped to [0.55, 1.5] so glows and
      // cores can't degenerate. Labels, though, should really grow and shrink
      // with distance; with the clamp the whole cloud reads as flat. Only the
      // labels use this value (orbit-decor.js).
      g.rawScale = pr.scale;
    }
    for (const s of universe.systems) {
      s.sunWorld = worldPos(s.sunId, tSec);
      const pr = project(s.sunWorld, trig, cx, cy);
      s.sx = pr.x;
      s.sy = pr.y;
      s.d = pr.d;
      s.scale = depthScale(pr);
    }
  }

  // ── decor: lives in orbit-decor.js — the env hands it live state ────
  const decor = createOrbitDecor({
    getUniverse: () => universe,
    getStars: () => stars,
    getHole: () => hole,
    getOrbitRings: () => orbitRings,
    getMode: () => mode,
    getEnterAt: () => enterAt,
    getR: () => R,
    getWeather: deps.getWeather ?? (() => null),
    project, trigNow, inPlane, add, scale3, norm,
    depthScale, depthFade, frontFade, viewRect, inView,
    getSatLight: deps.getSatLight,
    getHues: deps.getHues,
  });

  const byDepth = (a, b) => (b.orbitDepth ?? 0) - (a.orbitDepth ?? 0);

  // ── live supernovae ────────────────────────────────────────────────
  const idHash = (str) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  };

  function spawnBurst(entry) {
    if (!universe) build();
    if (bursts.has(entry.id)) return;
    const h = idHash(entry.id);
    const g = universe.galaxies.find((x) => x.key === entry.cluster);
    const world = g
      ? inPlane(
          g.center,
          g.basis,
          (rnd(h, 173) - 0.5) * g.r * 1.3,
          (rnd(h, 179) - 0.5) * g.r * 1.3,
          (rnd(h, 181) - 0.5) * g.r * 0.3,
        )
      : { px: (rnd(h, 173) - 0.5) * R, py: (rnd(h, 179) - 0.5) * R * 0.5, pz: (rnd(h, 181) - 0.5) * R };
    bursts.set(entry.id, { world, born: performance.now(), entry });
    // #217: der Newborn wird SOFORT echter Bewohner des Universums — als
    // Disc-Mitglied seiner Galaxie an der Burst-Position. Der Stern brennt
    // nur noch als Effekt darüber; nach dem Verglühen bleibt der Node, und
    // Klick/Hover treffen von Anfang an ein reales Memory.
    if (g && !universe.disc.has(entry.id) && !universe.planets.has(entry.id)) {
      universe.disc.set(entry.id, {
        center: g.center,
        basis: g.basis,
        x: (rnd(h, 173) - 0.5) * g.r * 1.3,
        y: (rnd(h, 179) - 0.5) * g.r * 1.3,
        z: (rnd(h, 181) - 0.5) * g.r * 0.3,
        spin: g.spin,
      });
    }
  }

  /** Live-Position eines Bursts: adoptierte Newborns rotieren mit ihrer
   *  Disc (worldPos) — der Stern bleibt am Node kleben statt wegzudriften. */
  function burstWorld(id, b, tSec) {
    if (universe.disc.has(id) || universe.planets.has(id)) {
      return worldPos(id, tSec) ?? b.world;
    }
    return b.world;
  }

  function focusBurst(id) {
    const b = bursts.get(id);
    if (!b) return;
    const pr = project(burstWorld(id, b, performance.now() / 1000), trigNow(), innerWidth / 2, innerHeight / 2);
    deps.getInteractions().flyTo(pr.x, pr.y, 2.2, 900);
  }

  /** Draw all live bursts at their 3D positions — far-side ones recede. */
  function renderBursts(ctx, camera, theme, now) {
    if (!universe) return;
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    const trig = trigNow();
    for (const [id, b] of bursts) {
      const age = (now - b.born) / 1000;
      if (age > BURST_LIFE) {
        bursts.delete(id);
        continue;
      }
      const pr = project(burstWorld(id, b, now / 1000), trig, cx, cy);
      drawBurstAt(ctx, camera, theme, pr.x, pr.y, depthScale(pr), age, Math.max(depthFade(pr.d), 0.35));
    }
  }

  const listBursts = () =>
    [...bursts.entries()].map(([id, b]) => ({ id, born: b.born, cluster: b.entry.cluster }));

  /** Hit-Test für Live-Bursts: der Stern ist bis zu 2 Minuten das einzige
   *  Visual des neugeborenen Memorys — er muss klickbar sein. Nimmt
   *  WORLD-Koordinaten (renderer.toWorld) und spiegelt die gezeichnete
   *  Sterngröße aus drawBurstAt (starR ≈ max(7·depthScale, 10/camScale)). */
  function pickBurst(wx, wy) {
    if (!universe) return null;
    const trig = trigNow();
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    const camScale = deps.renderer.camera?.scale ?? 1;
    let best = null;
    let bestD = Infinity;
    for (const [id, b] of bursts) {
      const pr = project(burstWorld(id, b, performance.now() / 1000), trig, cx, cy);
      const hitR = Math.max(7 * depthScale(pr), 10 / camScale) * 2.6;
      const d = Math.hypot(wx - pr.x, wy - pr.y);
      if (d < hitR && d < bestD) {
        best = b.entry;
        bestD = d;
      }
    }
    return best;
  }

  // ── lifecycle ──────────────────────────────────────────────────────
  function enter() {
    if (!universe) build();
    enterAt = performance.now();
    deps.renderer.setQuietEdges(true);
    deps.renderer.setClusterLabelsVisible(false);
    deps.renderer.setDrawOrder(byDepth);
    deps.renderer.setDecor(decor);
    deps.getInteractions().setDragDelegate((dx, dy, ev) => {
      if (ev?.shiftKey) return false; // shift-drag = pan through space
      yaw += dx * 0.005;
      pitch = Math.min(Math.max(pitch + dy * 0.004, -PITCH_MAX), PITCH_MAX);
    });
    $("#orbit-hint").hidden = false;
    // flight targets are computed for LANDING time (the 950 ms view flight),
    // so planets land exactly where they will be — no angle snap
    const targets = new Map();
    apply(performance.now() / 1000 + 0.95, targets);
    return targets;
  }

  function exit() {
    deps.renderer.setQuietEdges(false);
    deps.renderer.setClusterLabelsVisible(true);
    deps.renderer.setDrawOrder(null);
    deps.renderer.setDecor(null);
    deps.getInteractions().setDragDelegate(null);
    $("#orbit-hint").hidden = true;
    for (const n of deps.sim.nodes) {
      delete n.ringScale;
      delete n.ringFade;
      delete n.orbitDepth;
    }
  }

  function tick(now) {
    // galactic drift: MUTATE the shared center objects — discs, sub rings,
    // systems and bursts all reference them, so the whole cloud rides along.
    // The clock accumulates only while actually drifting (no resume jump),
    // and pauses while the user navigates (the depth-view lesson: motion
    // must never fight the mouse).
    if (mode === "galaxy" && universe) {
      const dt = lastTick > 0 ? Math.min((now - lastTick) / 1000, 0.1) : 0;
      if (drift && now - lastInteract > DRIFT_RESUME_MS) orbitT += dt;
      for (const g of universe.galaxies) {
        if (!g.orbit) continue;
        const a = g.orbit.phase + g.orbit.omega * orbitT;
        g.center.px = Math.cos(a) * g.orbit.r;
        g.center.pz = Math.sin(a) * g.orbit.r;
        g.center.py = g.orbit.y;
      }
    }
    lastTick = now;
    apply(now / 1000);
  }

  /** Rebuild the universe in place (mode/option change while the view is
   *  open) — positions jump to the new layout under the decor fade-in. */
  function relayout() {
    universe = null;
    build();
    enterAt = performance.now();
    apply(performance.now() / 1000);
  }

  function setMode(m) {
    mode = m === "galaxy" ? "galaxy" : "universe";
    localStorage.setItem(MODE_KEY, mode);
    universe = null; // next enter/relayout builds the chosen layout
  }
  function setDistanceMode(m) {
    distanceMode = m === "balanced" ? "balanced" : "woven";
    localStorage.setItem(DIST_KEY, distanceMode);
    universe = null;
  }
  function setDrift(on) {
    drift = !!on;
    localStorage.setItem(DRIFT_KEY, drift ? "on" : "off");
  }

  return {
    enter, exit, tick, spawnBurst, focusBurst, renderBursts, listBursts, pickBurst,
    relayout,
    setMode,
    setDistanceMode,
    setDrift,
    getMode: () => mode,
    getDistanceMode: () => distanceMode,
    getDrift: () => drift,
  };
}
