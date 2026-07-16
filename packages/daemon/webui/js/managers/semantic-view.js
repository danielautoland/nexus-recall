/** Semantic view: nodes positioned by MEANING (server-side PCA over the
 *  embedding vectors) instead of by folder. The point of the view are the
 *  unwritten connections — pairs the embeddings consider close but no note
 *  ever linked — drawn as their own dashed strands. Cluster colors stay,
 *  so folder-vs-meaning disagreements show at a glance.
 *
 *  The server layout is cached for the session; entering again is instant.
 *
 *  @param {object} deps
 *  @param {object} deps.sim       simulation (nodes, edges, byId)
 *  @param {object} deps.renderer  canvas renderer */

import { fetchSemanticLayout, nodeRadius } from "../graph-data.js";

const $ = (sel) => document.querySelector(sel);
const GOLDEN = 2.399963; // radians — deterministic scatter for fallbacks

export function createSemanticView(deps) {
  let layout = null; // server response, fetched once per session
  let targets = null; // id → {x, y} world positions, relaxed
  let semEdges = []; // unwritten connections with node refs

  /** World targets from the unit-square layout: scale to a box that grows
   *  with the vault, place vectorless notes/ghosts near their linked
   *  neighbors, then relax until nothing overlaps (the no-overlap rule). */
  function computeTargets() {
    const placed = new Map();
    const side = Math.max(760, Math.sqrt(layout.positions.length) * 64);
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    for (const p of layout.positions) {
      placed.set(p.id, { x: cx + (p.x - 0.5) * side, y: cy + (p.y - 0.5) * side });
    }

    // fallbacks (ghosts, embedding gaps): average of already-placed link
    // neighbors; two passes so chains resolve; center scatter as last resort
    for (let pass = 0; pass < 2; pass++) {
      for (const n of deps.sim.nodes) {
        if (placed.has(n.id)) continue;
        let sx = 0;
        let sy = 0;
        let count = 0;
        for (const e of deps.sim.edges) {
          const other = e.s.id === n.id ? e.t : e.t.id === n.id ? e.s : null;
          const p = other && placed.get(other.id);
          if (p) {
            sx += p.x;
            sy += p.y;
            count++;
          }
        }
        if (count > 0) {
          const a = n.idx * GOLDEN;
          placed.set(n.id, {
            x: sx / count + Math.cos(a) * 30,
            y: sy / count + Math.sin(a) * 30,
          });
        }
      }
    }
    for (const n of deps.sim.nodes) {
      if (placed.has(n.id)) continue;
      const a = n.idx * GOLDEN;
      const r = 40 + 14 * Math.sqrt(n.idx);
      placed.set(n.id, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }

    relax(placed);
    return placed;
  }

  /** Radius-aware separation on the target map — PCA packs the middle
   *  densely; a few push-apart passes make every node hittable. */
  function relax(placed) {
    const items = deps.sim.nodes.map((n) => ({
      p: placed.get(n.id),
      r: nodeRadius(n) + 5,
    }));
    for (let it = 0; it < 24; it++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          const dx = b.p.x - a.p.x;
          const dy = b.p.y - a.p.y;
          const min = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2) || 0.01;
          const push = (min - d) / 2 + 0.3;
          const ux = d < 0.02 ? Math.cos(i * GOLDEN) : dx / d;
          const uy = d < 0.02 ? Math.sin(i * GOLDEN) : dy / d;
          a.p.x -= ux * push;
          a.p.y -= uy * push;
          b.p.x += ux * push;
          b.p.y += uy * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  /** Fetches (once), computes targets, arms the dashed strands. Returns the
   *  node target positions for the caller's view transition. Throws when the
   *  daemon has no embeddings yet — the caller keeps the current view. */
  async function enter() {
    if (!layout) layout = await fetchSemanticLayout();
    if (!targets) {
      targets = computeTargets();
      semEdges = layout.edges
        .map((e) => ({ s: deps.sim.byId.get(e.source), t: deps.sim.byId.get(e.target), sim: e.sim }))
        .filter((e) => e.s && e.t);
    }
    deps.renderer.setSemanticEdges(semEdges);
    deps.renderer.setClusterLabelsVisible(false); // clusters interleave here
    $("#semantic-hint").hidden = false;
    return targets;
  }

  function exit() {
    deps.renderer.setSemanticEdges(null);
    deps.renderer.setClusterLabelsVisible(true);
    $("#semantic-hint").hidden = true;
  }

  return {
    enter,
    exit,
    /** unwritten connections (node refs) — [] until the view was entered */
    getEdges: () => semEdges,
  };
}
