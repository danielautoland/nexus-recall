/** Canvas renderer. All colors come from the --map-* CSS custom properties,
 *  read at theme load/toggle — the theme switch recolors the map itself.
 *  Calm by default: edges are near-invisible until a node is hovered or
 *  focused, then its neighborhood lights up and the rest dims. */

import { clusterColor, nodeRadius } from "./graph-data.js";

export function createRenderer(canvas, sim, initialHues) {
  const ctx = canvas.getContext("2d");
  let hues = initialHues; // swapped on structure-mode change
  const camera = { x: 0, y: 0, scale: 1 };
  let theme = readTheme();
  let hover = null; // node under cursor
  let focus = null; // clicked/selected node
  let highlightCluster = null; // legend hover
  let filterFn = null; // active sidebar filter — non-matching nodes dim
  let decorFn = null; // view decor (ring guides, center emblem), world space
  let quietEdges = false; // ring view: no ambient edges, only the active node's
  let clusterLabels = true; // ring view draws names curved in the band instead
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

  /** Set of ids in the active neighborhood (hover wins over focus). */
  function activeSet() {
    const pivot = hover ?? focus;
    if (!pivot) return null;
    const set = new Set([pivot.id]);
    for (const e of sim.edges) {
      if (e.s.id === pivot.id) set.add(e.t.id);
      if (e.t.id === pivot.id) set.add(e.s.id);
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
    const pulse = 1 + Math.sin(now / 480) * 0.2;

    if (decorFn) decorFn(ctx, camera, theme, now, active !== null);

    // ── edges ──
    // Default state is a hint, not a picture: intra-cloud edges are faint,
    // cross-cloud edges barely there. Full strength only around the active
    // node — that's when the strands matter.
    ctx.lineWidth = 1 / camera.scale;
    for (const e of sim.edges) {
      const isActive = pivotId !== null && (e.s.id === pivotId || e.t.id === pivotId);
      if (quietEdges && !isActive) continue; // ring: strands only on hover/focus
      if (active && !isActive) continue; // calm: hide unrelated edges entirely
      ctx.strokeStyle = isActive ? theme.edgeHi : theme.edge;
      if (!isActive && e.s.cluster !== e.t.cluster) ctx.globalAlpha = 0.3;
      if (isActive) ctx.lineWidth = 1.5 / camera.scale;
      ctx.beginPath();
      ctx.moveTo(e.s.x, e.s.y);
      ctx.lineTo(e.t.x, e.t.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (isActive) ctx.lineWidth = 1 / camera.scale;
    }

    // ── nodes ──
    for (const n of sim.nodes) {
      let r = drawRadius(n);
      const dimmed =
        (active && !active.has(n.id)) ||
        (highlightCluster !== null && n.cluster !== highlightCluster) ||
        (filterFn !== null && !filterFn(n));
      // filter matches breathe: statically drawn nodes get a soft pulse so
      // "what did this filter select" is visible at a glance
      const filterHit = !dimmed && filterFn !== null && filterFn(n);
      if (filterHit && n.kind !== "ghost") r *= 1 + Math.sin(now / 350 + n.idx * 1.7) * 0.14;
      ctx.globalAlpha = dimmed ? theme.dim : 1;
      const color = colorOf(n);

      if (n.kind === "ghost") {
        const rr = r * (filterHit ? pulse * 1.15 : pulse);
        // tinted backing disc — the dashed outline alone was too faint
        ctx.fillStyle = color;
        ctx.globalAlpha = (dimmed ? theme.dim : 1) * 0.22;
        ctx.beginPath();
        ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = dimmed ? theme.dim : 1;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6 / camera.scale;
        ctx.setLineDash([3 / camera.scale, 3 / camera.scale]);
        ctx.beginPath();
        ctx.arc(n.x, n.y, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        if (theme.glowAlpha > 0.02 && !dimmed) {
          const g = ctx.createRadialGradient(n.x, n.y, r * 0.4, n.x, n.y, r * 3);
          g.addColorStop(0, color);
          g.addColorStop(1, "transparent");
          ctx.globalAlpha = (dimmed ? theme.dim : 1) * theme.glowAlpha;
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = dimmed ? theme.dim : 1;
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
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
        ctx.globalAlpha = 0.45 * (dimmed ? theme.dim : 1);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 6 * hs, 0, Math.PI * 2);
        ctx.stroke();
      }

      // focus ring
      if (focus && n.id === focus.id) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = theme.edgeHi;
        ctx.lineWidth = 1.6 / camera.scale;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 4.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

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
      if (highlightCluster !== null && key !== highlightCluster) ctx.globalAlpha = theme.dim;
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
      const dx = n.x - p.x;
      const dy = n.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) - drawRadius(n) - slop / camera.scale;
      if (d < 0 && d < bestD) {
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
    setHover: (n) => (hover = n),
    setFocus: (n) => (focus = n),
    getFocus: () => focus,
    setHighlightCluster: (key) => (highlightCluster = key),
    setFilter: (fn) => (filterFn = fn),
    setDecor: (fn) => (decorFn = fn),
    setQuietEdges: (on) => (quietEdges = on),
    setClusterLabelsVisible: (on) => (clusterLabels = on),
    setHues: (h) => (hues = h),
  };
}
