/** Canvas renderer. All colors come from the --map-* CSS custom properties,
 *  read at theme load/toggle — the theme switch recolors the map itself.
 *  Calm by default: edges are near-invisible until a node is hovered or
 *  focused, then its neighborhood lights up and the rest dims. */

import { clusterColor, nodeRadius, glowSprite, EMOTION_CORE } from "./graph-data.js";
import { BOLT_STYLES, boltRnd, storedBoltStyle, BOLT_STYLE_KEY } from "./bolt-styles.js";

// Activity bolts (#217): a flaring node discharges along its connections.
//
// The bolt travels the STRAND, not the straight line between two nodes: edges
// are drawn as quadratic curves (edgeBend), so a chord-based zigzag ran beside
// the very connection it was meant to trace — on cross-cluster edges by up to
// the full 90px bulge. Same look, right path.
//
// And it does not stop at the first neighbour: the discharge carries on, memory
// to memory to memory. What keeps that from turning into a web is not the hop
// limit alone but the falloff — the first leg is the event, every further leg
// is only the echo of it (0.22 per level: 1 · 0.22 · 0.05).
const BOLT_HOPS = 3; // how far the discharge carries
// Level 1 takes EVERY connection the flaring memory has — that is the event
// itself, and hovering the node shows exactly the same set of strands. Beyond
// it the chain thins out instead of branching: only some neighbours carry on
// (BOLT_SPREAD_CHANCE), and those take a single strand each. Thinning, not
// dimming alone, is what keeps a chain from becoming a web.
const BOLT_FANOUT = [Infinity, 1, 1];
const BOLT_SPREAD_CHANCE = [1, 0.35, 0.2]; // odds a neighbour passes the discharge on
const BOLT_MAX_LEGS = 96; // emergency ceiling — a hub with degree 300 must not eat the frame
const BOLT_HOP_FALLOFF = 0.22; // visibility per level beyond the first
const BOLT_HOP_DELAY_MS = 110; // stagger per level; < BOLT_MS, so the chain never breaks
const BOLT_MS = 420; // arc duration — a fraction of the node's flare lifetime
const BOLT_TICK_MS = 55; // re-rolling the zigzag: below ~40ms it turns to noise
const FLASH_LIFE_MAX = 20000; // ceiling, so constant access can't flare forever

/** Stable number for a memory id — the seed for everything about a bolt that
 *  must not change between two flares of the same memory. */
function idSeed(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100000;
  return h;
}

export function createRenderer(canvas, sim, initialHues) {
  const ctx = canvas.getContext("2d");
  let hues = initialHues; // swapped on structure-mode change
  const camera = { x: 0, y: 0, scale: 1 };
  let theme = readTheme();
  let hover = null; // node under cursor
  let focus = null; // clicked/selected node
  let lastPivotId = null; // flow animation: detect pivot changes …
  let pivotSince = 0; // … so the pulses ease in instead of popping
  let focusSince = 0; // focus beacon: birth burst + sonar timing
  let highlightFn = null; // legend hover predicate (nodes outside it dim)
  const flashes = new Map(); // live-notice flash (#216): id → {color, born, life, boltAt, links}
  let boltStyle = storedBoltStyle(); // how activity travels a strand — sidebar switch

  /** The chain of edges an activity bolt travels: breadth-first from the
   *  flaring node, up to BOLT_HOPS levels deep, as [{ e, hop }].
   *
   *  Resolved once when the flare is lit and kept on the flash — the EDGES are
   *  held, so the draw loop re-reads n.x/n.y every frame and the chain follows
   *  moving nodes; only the selection is fixed. A node is entered once
   *  (`seen`), so the discharge spreads outward instead of bouncing back and
   *  forth between two hubs. Per level only BOLT_FANOUT branches per node: on a
   *  hub any selection is arbitrary, and "the first ones" is the cheapest
   *  honest answer. */
  function boltChainOf(id) {
    const legs = [];
    const seen = new Set([id]);
    let frontier = [id];
    for (let hop = 1; hop <= BOLT_HOPS && frontier.length; hop++) {
      const next = [];
      const cap = BOLT_FANOUT[hop - 1] ?? 1;
      const chance = BOLT_SPREAD_CHANCE[hop - 1] ?? 0;
      for (const from of frontier) {
        // Beyond the first level only some neighbours carry on. WHICH ones is
        // derived from the memory's identity, not from the clock: a lit strand
        // claims "these two belong together", and that claim has to hold still.
        // The same memory therefore always draws the same chain — recognisable
        // across flares and across sessions.
        if (chance < 1 && boltRnd(idSeed(from) + hop * 977.3) > chance) continue;
        let taken = 0;
        for (const e of sim.edges) {
          if (taken >= cap || legs.length >= BOLT_MAX_LEGS) break;
          const other = e.s?.id === from ? e.t : e.t?.id === from ? e.s : null;
          if (!other || other.ringHidden || seen.has(other.id)) continue;
          seen.add(other.id);
          legs.push({ e, hop });
          next.push(other.id);
          taken++;
        }
      }
      frontier = next;
    }
    return legs;
  }
  let highlightLabelKey = null; // cloud label to keep bright while hovering
  let filterFn = null; // active sidebar filter — non-matching nodes dim
  let decorFn = null; // view decor (ring guides, center emblem), world space
  let drawOrder = null; // node paint order (orbit view: back-to-front)
  let overlayFn = null; // drawn after nodes (live supernovae) — every view
  let quietEdges = false; // ring view: no ambient edges, only the active node's
  let clusterLabels = true; // ring view draws names curved in the band instead
  let semEdges = null; // semantic view: unwritten connections, dashed layer
  const labelBounds = new Map(); // cluster key → world-space label box (drag handle)

  function readTheme() {
    const s = getComputedStyle(document.documentElement);
    const v = (name) => s.getPropertyValue(name).trim();
    return {
      edge: v("--map-edge"),
      edgeHi: v("--map-edge-hi"),
      label: v("--map-label"),
      labelHalo: v("--map-label-halo"),
      sat: v("--map-node-sat"),
      light: v("--map-node-light"),
      glowAlpha: parseFloat(v("--map-glow-alpha")),
      dim: parseFloat(v("--map-dim")),
      ghost: v("--map-ghost"),
      bridge: v("--map-bridge"),
      band: v("--map-band"),
      bandBorder: v("--map-band-border"),
      accentSoft: v("--accent-soft"),
      accent: v("--accent"),
      flow: v("--map-flow"),
      flowTail: v("--map-flow-tail"),
      flowBlend: v("--map-flow-blend") || "source-over",
    };
  }

  function refreshTheme() {
    theme = readTheme();
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const colorOf = (n) => (n.kind === "ghost" ? theme.ghost : clusterColor(hues, n.cluster, theme.sat, theme.light));
  // ring view sets ringScale to damp sizes near the hub; clouds leave it unset
  const drawRadius = (n) => nodeRadius(n) * (n.ringScale ?? 1);

  let bendCenter = null; // ring hub — when set, strands bow toward it

  /** Control point for an edge, or null for a straight line. Cross-cloud
   *  strands bow gently to the side (flight-route look — long lines stop
   *  cutting straight through foreign clouds); in the ring view every
   *  strand bows toward the hub instead. Computed on (s, t) so the base
   *  stroke and the sheen share the exact same curve. */
  function edgeBend(e) {
    const a = e.s;
    const b = e.t;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 40) return null;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if (bendCenter) {
      const cx = bendCenter.x - mx;
      const cy = bendCenter.y - my;
      const cd = Math.hypot(cx, cy);
      if (cd < 1) return null;
      const pull = Math.min(dist * 0.18, cd * 0.5);
      return { x: mx + (cx / cd) * pull, y: my + (cy / cd) * pull };
    }
    if (a.cluster === b.cluster) return null;
    const bulge = Math.min(dist * 0.1, 90);
    return { x: mx - (dy / dist) * bulge, y: my + (dx / dist) * bulge };
  }

  function strokeEdge(e) {
    const cp = edgeBend(e);
    ctx.beginPath();
    ctx.moveTo(e.s.x, e.s.y);
    if (cp) ctx.quadraticCurveTo(cp.x, cp.y, e.t.x, e.t.y);
    else ctx.lineTo(e.t.x, e.t.y);
    ctx.stroke();
  }

  /** Set of ids in the active neighborhood (hover wins over focus). */
  function activeSet() {
    const pivot = hover ?? focus;
    if (!pivot) return null;
    const set = new Set([pivot.id]);
    for (const list of semEdges ? [sim.edges, semEdges] : [sim.edges]) {
      for (const e of list) {
        if (e.s.id === pivot.id) set.add(e.t.id);
        if (e.t.id === pivot.id) set.add(e.s.id);
      }
    }
    return set;
  }

  function draw(now) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.scale, camera.scale);

    const active = activeSet();
    const pivotId = (hover ?? focus)?.id ?? null;
    if (pivotId !== lastPivotId) {
      lastPivotId = pivotId;
      pivotSince = now;
    }
    const pulse = 1 + Math.sin(now / 480) * 0.2;

    if (decorFn) decorFn(ctx, camera, theme, now, active !== null);

    // ── edges ──
    // Default state is a hint, not a picture: intra-cloud edges are faint,
    // cross-cloud edges barely there. Full strength only around the active
    // node — that's when the strands matter.
    ctx.lineWidth = 1 / camera.scale;
    for (const e of sim.edges) {
      if (e.s.ringHidden || e.t.ringHidden) continue; // drilled away (ring browser)
      const isActive = pivotId !== null && (e.s.id === pivotId || e.t.id === pivotId);
      // second hop: the connections AT the strands' target nodes light up
      // too — dimmer, so the eye still reads the direct strands first
      const isSecondary = !isActive && active !== null && (active.has(e.s.id) || active.has(e.t.id));
      if (quietEdges && !isActive && !isSecondary) continue; // ring/orbit: strands only on hover/focus
      if (active && !isActive && !isSecondary) continue; // calm: hide unrelated edges entirely
      if (isSecondary) {
        // the target node's own connections: ordinary strand ink, dashed —
        // quietly showing the real link, never competing with the direct rays
        ctx.strokeStyle = theme.edge;
        ctx.globalAlpha = Math.min((now - pivotSince) / 450, 1);
        ctx.setLineDash([4 / camera.scale, 4 / camera.scale]);
        strokeEdge(e);
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.strokeStyle = isActive ? theme.edgeHi : theme.edge;
      if (!isActive && e.s.cluster !== e.t.cluster) ctx.globalAlpha = 0.3;
      if (isActive) ctx.lineWidth = 1.5 / camera.scale;
      // guessed vs written (zzallirog): related_via strands are the model's
      // guess, not a link the user wrote — dash them so the eye reads the
      // solid (written) layer as the real structure.
      const guessed = e.via === "related_via";
      if (guessed) ctx.setLineDash([3 / camera.scale, 4 / camera.scale]);
      strokeEdge(e);
      if (guessed) ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      if (isActive) ctx.lineWidth = 1 / camera.scale;
    }

    // ── unwritten connections (semantic view) ──
    // The discoveries of this view: dashed strands between notes that mean
    // the same thing but were never linked. Ambient strength follows the
    // similarity; the active node's discoveries light up fully.
    if (semEdges) {
      ctx.lineWidth = 1 / camera.scale;
      ctx.setLineDash([5 / camera.scale, 5 / camera.scale]);
      ctx.strokeStyle = theme.bridge;
      for (const e of semEdges) {
        const isActive = pivotId !== null && (e.s.id === pivotId || e.t.id === pivotId);
        if (active && !isActive) continue;
        ctx.globalAlpha = isActive ? 0.9 : 0.1 + Math.min(0.25, (e.sim - 0.6) * 0.8);
        if (isActive) ctx.lineWidth = 1.5 / camera.scale;
        strokeEdge(e);
        ctx.globalAlpha = 1;
        if (isActive) ctx.lineWidth = 1 / camera.scale;
      }
      ctx.setLineDash([]);
    }

    // a quiet sheen glides along the active strands, under the nodes
    if (pivotId !== null) drawFlow(now, pivotId);

    // ── nodes ──
    // painter's order for the orbit view: back-to-front by depth, so front
    // nodes genuinely occlude the ones behind them
    const nodeList = drawOrder ? [...sim.nodes].sort(drawOrder) : sim.nodes;
    for (const n of nodeList) {
      if (n.ringHidden) continue; // drilled away (ring browser)
      const fade = n.ringFade ?? 1; // fan-out crossfade multiplier
      if (fade <= 0.02) continue;
      let r = drawRadius(n);
      // a legend hover is a PREVIEW — while it lasts it outranks the active
      // filter and the focus neighborhood, else its nodes could never light up
      const dimmed = highlightFn !== null
        ? !highlightFn(n)
        : (active && !active.has(n.id)) || (filterFn !== null && !filterFn(n));
      // filter matches breathe: statically drawn nodes get a soft pulse so
      // "what did this filter select" is visible at a glance
      const filterHit = !dimmed && filterFn !== null && filterFn(n);
      if (filterHit && n.kind !== "ghost") r *= 1 + Math.sin(now / 350 + n.idx * 1.7) * 0.14;
      const nodeAlpha = (dimmed ? theme.dim : 1) * fade;
      ctx.globalAlpha = nodeAlpha;
      const color = colorOf(n);

      // impact glow: the nodes where the active strands land breathe with a
      // soft round halo — no ring, no crosshair, just light
      if (active !== null && n.id !== pivotId && active.has(n.id)) {
        const gr = Math.max(r * 3.2, 16 / camera.scale);
        ctx.globalAlpha = nodeAlpha * (0.4 + 0.14 * Math.sin(now / 260));
        ctx.drawImage(glowSprite(theme.edgeHi), n.x - gr, n.y - gr, gr * 2, gr * 2);
        ctx.globalAlpha = nodeAlpha;
      }


      if (n.kind === "ghost") {
        const rr = r * (filterHit ? pulse * 1.15 : pulse);
        // tinted backing disc — the dashed outline alone was too faint
        ctx.fillStyle = color;
        ctx.globalAlpha = nodeAlpha * 0.22;
        ctx.beginPath();
        ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = nodeAlpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6 / camera.scale;
        ctx.setLineDash([3 / camera.scale, 3 / camera.scale]);
        ctx.beginPath();
        ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (n.kind === "skill") {
        // declared skill (#215): solid core + solid outline ring — reads as
        // "real, but living elsewhere" (vs the dashed unwritten ghost)
        ctx.fillStyle = color;
        ctx.globalAlpha = nodeAlpha * 0.55;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r * 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = nodeAlpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6 / camera.scale;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // #217 Valenz: emotional heiße Memories brennen wie ein kleiner Stern.
        // Bewusst NICHT an theme.glowAlpha gekoppelt (0.14–0.35 dämpft alles
        // in den Hintergrund) und mit Screen-px-Mindestgröße — muss auch weit
        // rausgezoomt und neben großen Hubs auf einen Blick referenzierbar
        // sein. Zweistufig wie die Supernova (drawBurstAt): weiter Hof in der
        // Emotionsfarbe + heller Kern, beide atmen langsam.
        const sal = typeof n.salience === "number" ? Math.min(Math.max(n.salience, 0), 1) : 0;
        if (sal > 0 && !dimmed) {
          const emo = EMOTION_CORE[n.emotion] ?? color;
          const breath = 1 + 0.14 * Math.sin(now / 380 + n.idx * 1.3);
          const outer = Math.max(r * 3.2, (16 + sal * 30) / camera.scale) * breath;
          ctx.globalAlpha = nodeAlpha * (0.28 + sal * 0.38);
          ctx.drawImage(glowSprite(emo), n.x - outer, n.y - outer, outer * 2, outer * 2);
          const inner = outer * 0.55;
          ctx.globalAlpha = Math.min(1, nodeAlpha * (0.5 + sal * 0.45));
          ctx.drawImage(glowSprite(emo, theme.label), n.x - inner, n.y - inner, inner * 2, inner * 2);
          ctx.globalAlpha = nodeAlpha;
        } else if (theme.glowAlpha > 0.02 && !dimmed) {
          // pre-rendered sprite — a per-node radial gradient every frame was
          // the #1 frame-budget hotspot (hundreds of allocations)
          ctx.globalAlpha = nodeAlpha * theme.glowAlpha;
          ctx.drawImage(glowSprite(color), n.x - r * 3, n.y - r * 3, r * 6, r * 6);
          ctx.globalAlpha = nodeAlpha;
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (n.heat && !dimmed) {
          // #217: Usage-Heat (#154) — oft angewandte Memories tragen einen
          // hellen Kern; die zweite Demand-Uhr neben dem Salience-Glow.
          ctx.globalAlpha = nodeAlpha * n.heat * 0.5;
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 0.45, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = nodeAlpha;
        }
      }

      // bridge halo — connections the folder tree doesn't show. The offsets
      // scale with ringScale too, so halos respect the wedge borders.
      if (n.bridge && !dimmed) {
        const hs = n.ringScale ?? 1;
        ctx.strokeStyle = theme.bridge;
        ctx.lineWidth = 1.1 / camera.scale;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3.2 * hs, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 0.45 * nodeAlpha;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 6 * hs, 0, Math.PI * 2);
        ctx.stroke();
      }

      // focus beacon — the click echoes: a bright birth burst, then calm
      // sonar rings breathing outward, so the picked thought stays findable
      // in the crowd without shouting
      if (focus && n.id === focus.id) {
        const age = now - focusSince;
        ctx.globalAlpha = 1;
        ctx.strokeStyle = theme.edgeHi;
        ctx.lineWidth = 1.6 / camera.scale;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 4.5, 0, Math.PI * 2);
        ctx.stroke();
        for (let p = 0; p < 2; p++) {
          const t = (age / 1800 + p * 0.5) % 1;
          ctx.globalAlpha = (1 - t) * 0.55;
          ctx.lineWidth = (1.8 - t * 1.2) / camera.scale;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 4.5 + t * 22, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (age < 600) {
          const t = age / 600;
          ctx.globalAlpha = (1 - t) * 0.9;
          ctx.strokeStyle = theme.flow;
          ctx.lineWidth = (2.2 - t * 1.4) / camera.scale;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 4 + t * 30, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    // live-notice flashes (#216): ÜBER der Node-Ebene — in dichten Galaxien
    // würde ein Halo im Painter's-Order sonst von Nachbarn verdeckt. Erst
    // ein expandierender Ring (das bewährte Supernova-Zitat), dann ein
    // pulsierender Halo in der Kind-Farbe, beides mit Screen-px-Floors.
    for (const [id, f] of flashes) {
      const n = sim.byId.get(id);
      if (!n || n.ringHidden) {
        flashes.delete(id);
        continue;
      }
      const t = (now - f.born) / f.life;
      if (t >= 1) {
        flashes.delete(id);
        continue;
      }
      const r = drawRadius(n);
      // Activity bolts FIRST: they run underneath the ring and the halo, so the
      // flaring node stays the hero and the edges merely hint at where the
      // activity radiates.
      const chainAge = now - f.boltAt;
      if (chainAge < BOLT_MS + BOLT_HOPS * BOLT_HOP_DELAY_MS && f.links.length) {
        const tick = Math.floor(now / BOLT_TICK_MS);
        const style = BOLT_STYLES[boltStyle] ?? BOLT_STYLES.bolt;
        ctx.strokeStyle = f.color;
        ctx.lineJoin = "round";
        f.links.forEach((leg, i) => {
          const e = leg.e;
          if (e.s.ringHidden || e.t.ringHidden) return;
          // each level starts a little later, so the discharge visibly runs on
          // instead of every leg lighting up at once
          const t = (chainAge - (leg.hop - 1) * BOLT_HOP_DELAY_MS) / BOLT_MS;
          if (t <= 0 || t >= 1) return;
          // fast in, slow out — activity strikes and then burns down
          const strength = Math.min(t * 6, 1) * (1 - t) * BOLT_HOP_FALLOFF ** (leg.hop - 1);
          // WHICH strands and HOW STRONG is settled here; WHAT is painted on
          // them belongs to the chosen style (bolt-styles.js). Every style
          // draws on the strand's own curve — strokeEdge is handed over so the
          // lit connection is literally the same line the map draws.
          style.draw({
            ctx,
            e,
            cp: edgeBend(e),
            t,
            strength,
            seed: tick + i * 131,
            camScale: camera.scale,
            strokeEdge,
          });
        });
      }
      const ringT = Math.min((now - f.born) / 900, 1);
      if (ringT < 1) {
        const ringR = Math.max(r * 2, 10 / camera.scale) + ringT * (80 / camera.scale);
        ctx.globalAlpha = 0.75 * (1 - ringT);
        ctx.lineWidth = 2.2 / camera.scale;
        ctx.strokeStyle = f.color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }
      const ease = 1 - t * t;
      const fr = Math.max(r * 4, 36 / camera.scale) * (1 + 0.15 * Math.sin(now / 160));
      ctx.globalAlpha = Math.min(1, 0.9 * ease);
      ctx.drawImage(glowSprite(f.color, theme.label), n.x - fr, n.y - fr, fr * 2, fr * 2);
      ctx.globalAlpha = 1;
    }

    // ── overlay (live supernovae): after nodes, in every view ──
    if (overlayFn) overlayFn(ctx, camera, theme, now);

    // ── cluster labels (also the drag handles — bounds cached per frame) ──
    if (!clusterLabels) {
      labelBounds.clear();
      ctx.restore();
      return;
    }
    const fontPx = Math.max(11 / camera.scale, 4);
    ctx.font = `600 ${fontPx}px "Avenir Next", system-ui, sans-serif`;
    ctx.textAlign = "center";
    for (const [key, c] of sim.centers) {
      if (highlightLabelKey !== null && key !== highlightLabelKey) ctx.globalAlpha = theme.dim;
      const label = key.toUpperCase();
      // ring view sets an exact label anchor (c.ly); clouds derive it from
      // the cloud's size above the centroid
      const ly = c.ly !== undefined ? c.ly : c.y - Math.sqrt(c.count) * 6.5 - 14 / camera.scale;
      ctx.lineWidth = 3.5 / camera.scale;
      ctx.strokeStyle = theme.labelHalo;
      ctx.strokeText(label, c.x, ly);
      ctx.fillStyle = theme.label;
      ctx.fillText(label, c.x, ly);
      ctx.globalAlpha = 1;
      const w = ctx.measureText(label).width;
      const pad = 6 / camera.scale;
      labelBounds.set(key, {
        x: c.x - w / 2 - pad,
        y: ly - fontPx - pad,
        w: w + pad * 2,
        h: fontPx + pad * 2,
      });
    }

    ctx.restore();
  }

  /** Sheen on the active strands: a soft band of light glides along each
   *  edge from the pivot outward — the line itself catches light, nothing
   *  travels ON it. Constant world speed, staggered per strand so the
   *  strands breathe instead of marching in sync, eased in after a pivot
   *  change. Additive blend in the dark theme. */
  function drawFlow(now, pivotId) {
    const ramp = Math.min(1, (now - pivotSince) / 400);
    if (ramp <= 0.02) return;
    const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
    ctx.save();
    ctx.globalCompositeOperation = theme.flowBlend;
    ctx.lineWidth = 1.6 / camera.scale;
    const WAVE_SPAN = 200; // period reference (~mid-length line); see phase below
    let k = 0;
    for (const e of semEdges ? [...sim.edges, ...semEdges] : sim.edges) {
      if (e.s.id !== pivotId && e.t.id !== pivotId) continue;
      if (e.s.ringHidden || e.t.ringHidden) continue;
      k++;
      const from = e.s.id === pivotId ? e.s : e.t;
      const to = e.s.id === pivotId ? e.t : e.s;
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      if (dist < 24) continue;
      const fade = Math.min(from.ringFade ?? 1, to.ringFade ?? 1);
      if (fade <= 0.05) continue;
      // fixed-length band of light (not a fraction of the strand): long
      // cross-cloud strands get the same compact glint as short local ones,
      // and enough of them that the next pass is never far away
      const W = Math.min(60, dist * 0.4) / dist; // half-width as a fraction
      // one wave every ~280 px — the SAME density on the mindspace's long
      // rays as on short local strands (a cap here visibly thinned them out)
      const count = 1 + Math.floor(dist / 280);
      // unhurried, and each strand at its own slightly different pace —
      // organic drift instead of a synchronized march
      const speed = 42 + ((k * 53) % 23);
      // Zeitbasierte Phase mit EINHEITLICHER Periode auf allen Linien: die
      // gewrappte Weltstrecke wird über die feste WAVE_SPAN normiert, NICHT über
      // `dist` — sonst hängt die wahrgenommene Wellenfrequenz an der Linienlänge
      // (kurze flackern schnell durch, lange kriechen). WAVE_SPAN ≈ mittellange
      // Linie, damit sich das Tempo dort nicht ändert. Erst wrappen (Zähler
      // bleibt < WAVE_SPAN), dann normieren: konstante Periode, kein
      // Zeitdilatations-Bug (period hing sonst an dist, und now · Δperiod/period²
      // skalierte jede minimale Node-Drift mit dem Session-Alter → Welle wurde
      // umso schneller, je länger die Map offen war).
      const phase = (((now * speed) / 1000) % WAVE_SPAN) / WAVE_SPAN;
      ctx.globalAlpha = 0.4 * ramp * fade;
      for (let p = 0; p < count; p++) {
        // peak sweeps -W → 1+W so the sheen slides off both ends (no popping)
        const t = ((phase + k * 0.41 + p / count) % 1) * (1 + 2 * W) - W;
        const g = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
        g.addColorStop(clamp01(t - W), theme.flowTail);
        g.addColorStop(clamp01(t), theme.flow);
        g.addColorStop(clamp01(t + W), theme.flowTail);
        ctx.strokeStyle = g;
        strokeEdge(e);
      }
    }
    ctx.restore();
  }

  /** screen → world */
  function toWorld(sx, sy) {
    return { x: (sx - camera.x) / camera.scale, y: (sy - camera.y) / camera.scale };
  }

  /** nearest node within `slop` screen px of a screen point */
  function pick(sx, sy, slop = 6) {
    const p = toWorld(sx, sy);
    let best = null;
    let bestD = Infinity;
    for (const n of sim.nodes) {
      if (n.ringHidden) continue;
      const dx = n.x - p.x;
      const dy = n.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) - drawRadius(n) - slop / camera.scale;
      // on overlapping hits the FRONT node wins (orbit depth), so the tooltip
      // never names a node hidden behind the one actually seen
      const depth = n.orbitDepth ?? 0;
      if (d < 0 && (best === null ? d < bestD : depth < (best.orbitDepth ?? 0) || (depth === (best.orbitDepth ?? 0) && d < bestD))) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  /** Cluster whose label sits under a screen point — the cloud drag handle. */
  function pickClusterLabel(sx, sy) {
    const p = toWorld(sx, sy);
    for (const [key, b] of labelBounds) {
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return key;
    }
    return null;
  }

  return {
    camera,
    resize,
    draw,
    pick,
    pickClusterLabel,
    toWorld,
    refreshTheme,
    /** Live notice (#216): the node flares briefly in the kind's colour, and a
     *  bolt discharges along its connections, memory to memory to memory (#217).
     *
     *  Calling this again for the same id EXTENDS the flare rather than
     *  restarting it: repeated hits on the same memory should feel like
     *  sustained activity, not like a single hit that happens to start over.
     *  Every call re-fires the bolts.
     *
     *  Note: the re-announce cooldown in the daemon (live-updates.ts) throttles
     *  repeated "read" notices for the same id — so the extension mostly bites
     *  when several DIFFERENT memories flare at once, and through the ×N count
     *  the caller folds into lifeMs. */
    flashNode: (id, color, lifeMs = 5000) => {
      const now = performance.now();
      const prev = flashes.get(id);
      if (prev) {
        prev.color = color;
        prev.life = Math.min(prev.life + lifeMs, FLASH_LIFE_MAX);
        prev.boltAt = now;
        return;
      }
      flashes.set(id, { color, born: now, life: lifeMs, boltAt: now, links: boltChainOf(id) });
    },
    setHover: (n) => (hover = n),
    setFocus: (n) => {
      if ((n?.id ?? null) !== (focus?.id ?? null)) focusSince = performance.now();
      focus = n;
    },
    getFocus: () => focus,
    setHighlight: (fn, labelKey = null) => {
      highlightFn = fn;
      highlightLabelKey = fn === null ? null : labelKey;
    },
    setFilter: (fn) => (filterFn = fn),
    setDecor: (fn) => (decorFn = fn),
    setDrawOrder: (fn) => (drawOrder = fn),
    setOverlay: (fn) => (overlayFn = fn),
    /** Activity animation: "bolt" | "pulse" | "trace" (bolt-styles.js). The
     *  choice survives a reload — it is a taste, not a session state. */
    getBoltStyle: () => boltStyle,
    setBoltStyle: (id) => {
      if (!BOLT_STYLES[id]) return;
      boltStyle = id;
      try {
        localStorage.setItem(BOLT_STYLE_KEY, id);
      } catch {
        /* storage disabled — the switch still works for this session */
      }
    },
    setQuietEdges: (on) => (quietEdges = on),
    setBendCenter: (pt) => (bendCenter = pt),
    setSemanticEdges: (list) => (semEdges = list),
    setClusterLabelsVisible: (on) => (clusterLabels = on),
    setHues: (h) => (hues = h),
  };
}
