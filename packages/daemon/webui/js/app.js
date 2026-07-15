/** Bootstrap: load the graph, wire theme/search/inspector/panel, run the
 *  render loop. Theme default follows prefers-color-scheme; the toggle
 *  persists to localStorage and re-reads the --map-* palette so the canvas
 *  recolors with the chrome. */

import { fetchGraph, fetchHealth, fetchAnnotations, postAnnotation, fetchSemanticSearch, clusterHues, clusterColor } from "./graph-data.js";
import { computeRingLayout } from "./ring-layout.js";
import { createSimulation } from "./simulation.js";
import { createRenderer } from "./renderer.js";
import { createInteractions } from "./interactions.js";
import { createInspector } from "./inspector.js";
import { createSearch } from "./search.js";
import { createMinimap } from "./minimap.js";

const $ = (sel) => document.querySelector(sel);

// ── theme ────────────────────────────────────────────────────────
const THEME_KEY = "bastra-vault-map-theme";
const root = document.documentElement;
const stored = localStorage.getItem(THEME_KEY);
root.dataset.theme = stored ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");

async function main() {
  const canvas = $("#map");
  const graph = await fetchGraph();

  if (graph.vault_name) {
    $("#vault-name").textContent = graph.vault_name;
    document.title = `${graph.vault_name} — Vault Map`;
  }

  // ── structure mode: fine clusters ↔ memory building blocks (groups).
  // A display model, not a view — it applies to clouds AND ring alike.
  const STRUCTURE_KEY = "bastra-vault-map-structure";
  let structureMode = localStorage.getItem(STRUCTURE_KEY) === "blocks" ? "blocks" : "clusters";
  for (const n of graph.nodes) n.baseCluster = n.cluster; // fine layer, kept
  if (structureMode === "blocks") for (const n of graph.nodes) n.cluster = n.group;
  const activeGrouping = () => (structureMode === "blocks" ? graph.groups : graph.clusters);
  let hues = clusterHues(activeGrouping());

  // user-arranged cloud positions survive reloads — per structure mode
  const ANCHORS_KEY = "bastra-vault-map-cluster-pos";
  const anchorsKey = () => `${ANCHORS_KEY}:${structureMode}`;
  function loadAnchors() {
    try {
      return JSON.parse(localStorage.getItem(anchorsKey()) ?? "null");
    } catch {
      return null;
    }
  }

  const sim = createSimulation(graph, innerWidth, innerHeight, loadAnchors());
  const renderer = createRenderer(canvas, sim, hues);
  renderer.resize();

  let saveTimer = 0;
  function saveAnchorsSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem(anchorsKey(), JSON.stringify(sim.anchorPositions()));
    }, 400);
  }

  const themeSL = () => {
    const s = getComputedStyle(root);
    return [s.getPropertyValue("--map-node-sat").trim(), s.getPropertyValue("--map-node-light").trim()];
  };
  let [sat, light] = themeSL();
  const colorOf = (n) =>
    n.kind === "ghost"
      ? getComputedStyle(root).getPropertyValue("--map-ghost").trim()
      : clusterColor(hues, n.cluster, sat, light);

  $("#theme-toggle").addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, root.dataset.theme);
    renderer.refreshTheme();
    [sat, light] = themeSL();
    renderLegend(); // legend dots follow the theme's ink
  });

  // ── vault care (annotations worked off in an AI session) ──────
  const careMap = new Map(); // node id → entries
  function indexCare(entries) {
    careMap.clear();
    for (const a of entries) {
      const list = careMap.get(a.id) ?? [];
      list.push(a);
      careMap.set(a.id, list);
    }
  }
  indexCare(await fetchAnnotations());
  const openCareCount = () => [...careMap.values()].flat().filter((a) => !a.done).length;
  const hasOpenCare = (id) => (careMap.get(id) ?? []).some((a) => !a.done);

  // ── inspector + selection ──────────────────────────────────────
  const knownIds = new Set(sim.nodes.filter((n) => n.kind !== "ghost").map((n) => n.id));
  const inspector = createInspector($("#inspector"), $("#inspector-content"), {
    knownIds,
    clusterColorOf: colorOf,
    getCare: (id) => careMap.get(id) ?? [],
    onAnnotate: async (id, kind, note) => {
      await postAnnotation(id, kind, note);
      indexCare(await fetchAnnotations());
      renderSignals();
    },
    onNavigate: (id) => {
      const n = sim.byId.get(id);
      if (n) select(n, true);
    },
  });

  // ── views: clouds (force layout) ↔ ring (computed wheel) ───────
  const VIEW_KEY = "bastra-vault-map-view";
  let currentView = "clouds";
  let ring = null; // computeRingLayout result while in ring view
  let viewTransition = null; // { t0, ms, from, to }
  let cloudSnapshot = null; // node positions to return to

  // center emblem: uploaded vault image, else a monogram of the vault name
  const emblem = new Image();
  let emblemOk = false;
  function loadEmblem() {
    emblemOk = false;
    emblem.onload = () => (emblemOk = true);
    emblem.onerror = () => (emblemOk = false);
    emblem.src = `/ui/vault-image?ts=${Date.now()}`;
  }
  loadEmblem();
  $("#vault-image-input").addEventListener("change", async () => {
    const file = $("#vault-image-input").files[0];
    $("#vault-image-input").value = "";
    if (!file) return;
    const res = await fetch("/ui/vault-image", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (res.ok) loadEmblem();
  });

  /** Text along a circle arc, centered on `mid`. Flips on the lower half so
   *  it always reads left-to-right. Trims with an ellipsis when the segment
   *  is too narrow; skips entirely when even that doesn't fit. */
  function drawArcText(ctx, camera, text, r, mid, maxArc, color) {
    const fontPx = Math.max(11 / camera.scale, 3.5);
    ctx.font = `700 ${fontPx}px "Avenir Next", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const track = 1.3; // letterspacing on the arc
    const chars = [...text];
    const widths = chars.map((c) => ctx.measureText(c).width);
    let total = widths.reduce((s, w) => s + w, 0) * track;
    while (chars.length > 2 && total / r > maxArc) {
      chars.pop();
      widths.pop();
      chars[chars.length - 1] = "…";
      widths[widths.length - 1] = ctx.measureText("…").width;
      total = widths.reduce((s, w) => s + w, 0) * track;
    }
    if (total / r > maxArc) return;
    const flip = Math.sin(mid) > 0; // bottom half: rotate to stay readable
    const dir = flip ? -1 : 1;
    let a = mid - (dir * total) / (2 * r);
    for (let k = 0; k < chars.length; k++) {
      const w = widths[k] * track;
      const ca = a + (dir * w) / (2 * r);
      ctx.save();
      ctx.translate(ring.center.x + Math.cos(ca) * r, ring.center.y + Math.sin(ca) * r);
      ctx.rotate(ca + (flip ? -Math.PI / 2 : Math.PI / 2));
      ctx.fillStyle = color;
      ctx.fillText(chars[k], 0, 0);
      ctx.restore();
      a += (dir * w) / r;
    }
    ctx.textBaseline = "alphabetic";
  }

  let emblemAlpha = 1; // eases down while a node is active, back up after

  function ringDecor(ctx, camera, theme, now, hasActive) {
    if (!ring) return;
    const { center, orbits, segments, band } = ring;
    const bandMid = (band.rInner + band.rOuter) / 2;
    // the emblem fades out with the rest when a node takes the stage
    const targetAlpha = hasActive ? Math.max(theme.dim, 0.15) : 1;
    emblemAlpha += (targetAlpha - emblemAlpha) * 0.12;

    // the label band — a clearly visible ring between wedges and the orbit
    ctx.beginPath();
    ctx.arc(center.x, center.y, bandMid, 0, Math.PI * 2);
    ctx.lineWidth = band.rOuter - band.rInner;
    ctx.strokeStyle = theme.band;
    ctx.stroke();
    ctx.lineWidth = 1 / camera.scale;
    ctx.strokeStyle = theme.bandBorder;
    for (const r of [band.rInner, band.rOuter]) {
      ctx.beginPath();
      ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // the inner staggering ring: closes the gap between emblem and wedges —
    // pie dividers end here instead of running loose towards the image
    ctx.strokeStyle = theme.bandBorder;
    ctx.lineWidth = 1 / camera.scale;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.arc(center.x, center.y, center.rInnerRing, 0, Math.PI * 2);
    ctx.stroke();

    // ONE pie divider per boundary (drawn in the middle of each gap), a bit
    // more subdued than the band borders
    for (let i = 0; i < segments.length; i++) {
      const cur = segments[i];
      const next = segments[(i + 1) % segments.length];
      const a = i === segments.length - 1
        ? (cur.a1 + next.a0 + Math.PI * 2) / 2
        : (cur.a1 + next.a0) / 2;
      ctx.beginPath();
      ctx.moveTo(center.x + Math.cos(a) * center.rInnerRing, center.y + Math.sin(a) * center.rInnerRing);
      ctx.lineTo(center.x + Math.cos(a) * band.rOuter, center.y + Math.sin(a) * band.rOuter);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const seg of segments) {
      // blocks mode: dashed fine dividers between the staggered sub-wedges,
      // stopping at the band instead of crossing it
      if (seg.subDividers?.length) {
        ctx.strokeStyle = theme.bandBorder;
        ctx.lineWidth = 1 / camera.scale;
        ctx.globalAlpha = 0.45;
        ctx.setLineDash([4 / camera.scale, 4 / camera.scale]);
        for (const a of seg.subDividers) {
          ctx.beginPath();
          ctx.moveTo(center.x + Math.cos(a) * center.rInnerRing, center.y + Math.sin(a) * center.rInnerRing);
          ctx.lineTo(center.x + Math.cos(a) * band.rInner, center.y + Math.sin(a) * band.rInner);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      const mid = (seg.a0 + seg.a1) / 2;
      drawArcText(ctx, camera, seg.key.toUpperCase(), bandMid, mid, (seg.a1 - seg.a0) * 0.92, clusterColor(hues, seg.key, sat, light));
    }

    // outermost: the dashed unwritten orbit with its curved label at the top
    for (const o of orbits) {
      ctx.strokeStyle = theme.edge;
      ctx.lineWidth = 1 / camera.scale;
      if (o.dashed) ctx.setLineDash([4 / camera.scale, 5 / camera.scale]);
      ctx.beginPath();
      ctx.arc(center.x, center.y, o.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (o.key === "unwritten") {
        drawArcText(ctx, camera, "UNWRITTEN", o.r + 12, -Math.PI / 2, 0.8, theme.label);
      }
    }
    // center disc with emblem or monogram
    ctx.globalAlpha = emblemAlpha;
    ctx.fillStyle = theme.labelHalo;
    ctx.beginPath();
    ctx.arc(center.x, center.y, center.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = theme.edgeHi;
    ctx.lineWidth = 1.6 / camera.scale;
    ctx.stroke();
    if (emblemOk) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(center.x, center.y, center.r - 5, 0, Math.PI * 2);
      ctx.clip();
      // cover fit — non-square uploads must not distort
      const d = (center.r - 5) * 2;
      const s = Math.max(d / emblem.naturalWidth, d / emblem.naturalHeight);
      ctx.drawImage(
        emblem,
        center.x - (emblem.naturalWidth * s) / 2,
        center.y - (emblem.naturalHeight * s) / 2,
        emblem.naturalWidth * s,
        emblem.naturalHeight * s,
      );
      ctx.restore();
    } else {
      const initials = (graph.vault_name || "V")
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
      ctx.font = `700 ${center.r * 0.62}px "Avenir Next", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = theme.label;
      ctx.fillText(initials, center.x, center.y + 2);
      ctx.textBaseline = "alphabetic";
    }
    ctx.globalAlpha = 1;
  }

  function switchView(v) {
    if (v === currentView || viewTransition) return;
    const from = new Map(sim.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    let to;
    if (v === "ring") {
      cloudSnapshot = from;
      ring = computeRingLayout(sim.nodes, innerWidth, innerHeight);
      to = ring.positions;
      for (const [key, c] of sim.centers) {
        const rc = ring.centers.get(key);
        if (rc) {
          c.x = rc.x;
          c.y = rc.y;
        }
      }
      renderer.setDecor(ringDecor);
      renderer.setQuietEdges(true); // ring: strands only on hover/focus
      renderer.setClusterLabelsVisible(false); // names live in the band
      $("#ring-hint").hidden = false;
    } else {
      to = cloudSnapshot ?? from;
      ring = null;
      renderer.setDecor(null);
      renderer.setQuietEdges(false);
      renderer.setClusterLabelsVisible(true);
      $("#ring-hint").hidden = true;
      for (const c of sim.centers.values()) delete c.ly;
      for (const n of sim.nodes) delete n.ringScale; // full size in the clouds
      sim.reheat(0.3); // clouds settle again; centroids re-anchor the labels
      wasBusy = true;
    }
    currentView = v;
    localStorage.setItem(VIEW_KEY, v);
    $("#view-switch")
      .querySelectorAll("button")
      .forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    viewTransition = { t0: performance.now(), ms: 950, from, to };
  }

  $("#view-switch").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-view]");
    if (b) switchView(b.dataset.view);
  });

  /** Neighborhood of a node: itself + everything it connects to. */
  function neighborhoodOf(node) {
    const pts = [node];
    for (const e of sim.edges) {
      if (e.s.id === node.id) pts.push(e.t);
      if (e.t.id === node.id) pts.push(e.s);
    }
    return pts;
  }

  function select(node, fly = true) {
    renderer.setFocus(node);
    document.body.classList.toggle("inspector-open", node !== null);
    if (!node) {
      inspector.close();
      return;
    }
    // zoom in so the node and all its strands fill the view — inside the
    // viewport rectangle NOT covered by inspector/sidebar/topbar
    if (fly) interactions.flyToBounds(neighborhoodOf(node), { padding: 60, maxScale: 2.6 });
    inspector.show(node);
  }
  $("#inspector-close").addEventListener("click", () =>
    document.body.classList.remove("inspector-open"),
  );

  /** Screen areas covered by UI — fits/flights center in the free rectangle. */
  function mapInsets() {
    const inspectorOpen = !$("#inspector").hidden || document.body.classList.contains("inspector-open");
    const panelVisible = panelState.pinned || !panelState.collapsed;
    return {
      left: inspectorOpen ? 432 : 24,
      right: panelVisible ? 286 : 46,
      top: 70,
      bottom: 40,
    };
  }

  const interactions = createInteractions(canvas, renderer, sim, {
    onSelect: (n, sx, sy) => {
      if (n) {
        select(n);
        return;
      }
      // ring view: a click on the center emblem opens the image picker
      if (currentView === "ring" && ring && sx !== undefined) {
        const w = renderer.toWorld(sx, sy);
        if (Math.hypot(w.x - ring.center.x, w.y - ring.center.y) <= ring.center.r) {
          $("#vault-image-input").click();
          return;
        }
      }
      select(null);
    },
    onClusterDragEnd: () => saveAnchorsSoon(),
    getInsets: mapInsets,
    canDragClusters: () => currentView === "clouds",
    onHoverChange: (n, x, y) => {
      const tip = $("#tooltip");
      if (!n) {
        tip.hidden = true;
        return;
      }
      tip.innerHTML = "";
      const title = document.createElement("div");
      title.className = "t-title";
      title.textContent = n.title;
      const sub = document.createElement("div");
      sub.className = "t-sub";
      sub.textContent =
        n.kind === "ghost"
          ? `unwritten · linked ${n.degree}×`
          : `${n.cluster} · ${n.type} · ${n.degree} links`;
      tip.append(title, sub);
      tip.hidden = false;
      const pad = 14;
      tip.style.left = `${Math.min(x + pad, innerWidth - tip.offsetWidth - pad)}px`;
      tip.style.top = `${Math.min(y + pad, innerHeight - tip.offsetHeight - pad)}px`;
    },
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && inspector.isOpen()) select(null);
  });

  // ── right-click menu (vendored ctxmenu.js) ─────────────────────
  function nearestCluster(wx, wy) {
    let best = null;
    let bestD = Infinity;
    for (const [key, c] of sim.centers) {
      const d = Math.hypot(c.x - wx, c.y - wy) - Math.sqrt(c.count) * 14;
      if (d < bestD) {
        bestD = d;
        best = key;
      }
    }
    return best;
  }

  canvas.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    const node = renderer.pick(ev.clientX, ev.clientY);
    const w = renderer.toWorld(ev.clientX, ev.clientY);
    const cluster = node?.cluster ?? nearestCluster(w.x, w.y);
    const items = [];
    if (node) {
      items.push(
        { text: node.title.length > 34 ? `${node.title.slice(0, 33)}…` : node.title, isHeading: true },
        { text: "Zoom to connections", action: () => select(node) },
        { text: "Open in inspector", action: () => { renderer.setFocus(node); inspector.show(node); } },
        { isDivider: true },
      );
    }
    if (cluster) items.push({ text: `Fit cloud “${cluster}”`, action: () => interactions.flyToCluster(cluster) });
    items.push({
      text: "Fit everything",
      action: () => interactions.flyToBounds(sim.nodes, { padding: 90, maxScale: 1.6 }),
    });
    window.ctxmenu.show(items, ev);
  });

  // ── search: instant title match + the daemon's semantic recall ──
  createSearch($("#search"), $("#search-results"), sim.nodes, {
    colorOf,
    onPick: (n) => select(n, true),
    aiSearch: async (q) =>
      (await fetchSemanticSearch(q)).map((h) => sim.byId.get(h.id)).filter(Boolean),
  });

  // ── legend + panels ────────────────────────────────────────────
  const legendEl = $("#legend");
  function renderLegend() {
    legendEl.innerHTML = "";
    for (const c of activeGrouping()) {
      const li = document.createElement("li");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = clusterColor(hues, c.key, sat, light);
      dot.style.color = dot.style.background;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = c.key;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = c.count;
      li.append(dot, name, count);
      li.addEventListener("mouseenter", () => renderer.setHighlightCluster(c.key));
      li.addEventListener("mouseleave", () => renderer.setHighlightCluster(null));
      li.addEventListener("click", () => interactions.flyToCluster(c.key));
      legendEl.append(li);
    }
  }
  renderLegend();

  // ── filters: clickable signals + time range, combined with AND ──
  let signalKey = null; // "memories" | "ghosts" | "bridges" | "care" | null
  let timeDays = null; // 7 | 30 | 90 | null
  function applyFilter() {
    if (signalKey === null && timeDays === null) {
      renderer.setFilter(null);
      return;
    }
    const cutoff = timeDays
      ? new Date(Date.now() - timeDays * 86400e3).toISOString().slice(0, 10)
      : null;
    renderer.setFilter((n) => {
      if (cutoff !== null && !(n.updated && n.updated >= cutoff)) return false;
      if (signalKey === "memories" && n.kind === "ghost") return false;
      if (signalKey === "ghosts" && n.kind !== "ghost") return false;
      if (signalKey === "bridges" && !n.bridge) return false;
      if (signalKey === "care" && !hasOpenCare(n.id)) return false;
      return true;
    });
  }

  const kv = (k, v, ok = false) =>
    `<li><span class="k">${k}</span><span class="v${ok ? " ok" : ""}">${v}</span></li>`;
  const ghosts = sim.nodes.filter((n) => n.kind === "ghost").length;
  const bridges = sim.nodes.filter((n) => n.bridge).length;

  function renderSignals() {
    const rows = [
      { key: "memories", label: "memories", value: sim.nodes.length - ghosts },
      { key: null, label: "connections", value: sim.edges.length },
      { key: "ghosts", label: "unwritten notes", value: ghosts },
      { key: "bridges", label: "bridge nodes", value: bridges },
      { key: "care", label: "care flags", value: openCareCount() },
    ];
    const ul = $("#signals");
    ul.innerHTML = "";
    for (const r of rows) {
      const li = document.createElement("li");
      if (r.key) {
        li.className = `filterable${signalKey === r.key ? " active" : ""}`;
        li.title = "Click to filter the map";
        li.addEventListener("click", () => {
          signalKey = signalKey === r.key ? null : r.key;
          applyFilter();
          renderSignals();
        });
      }
      li.innerHTML = `<span class="k">${r.label}</span><span class="v">${r.value}</span>`;
      ul.append(li);
    }
  }
  renderSignals();

  $("#time-filter").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-days]");
    if (!btn) return;
    timeDays = btn.dataset.days === "" ? null : Number(btn.dataset.days);
    $("#time-filter").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    applyFilter();
  });

  $("#stat-count").textContent = `${graph.vault_size} memories`;

  fetchHealth().then((h) => {
    if (!h) return;
    $("#system").innerHTML =
      kv("daemon", `v${h.version}`, true) +
      kv("semantic recall", h.semantic_recall, h.semantic_recall === "on") +
      kv("embedding", h.embedding_mode);
  });

  // ── sidebar state: collapsed / pinned / accordion, persisted ────
  const PANEL_KEY = "bastra-vault-map-panel";
  let panelState = { collapsed: false, pinned: false, closed: {} };
  try {
    panelState = { ...panelState, ...JSON.parse(localStorage.getItem(PANEL_KEY) ?? "{}") };
  } catch { /* defaults */ }
  const panel = $("#system-panel");
  function applyPanelState() {
    panel.classList.toggle("pinned", panelState.pinned);
    panel.classList.toggle("collapsed", !panelState.pinned && panelState.collapsed);
    document.body.classList.toggle("panel-pinned", panelState.pinned);
    document.querySelectorAll(".panel-section[data-acc]").forEach((sec) => {
      sec.classList.toggle("closed", Boolean(panelState.closed[sec.dataset.acc]));
    });
  }
  function savePanelState() {
    localStorage.setItem(PANEL_KEY, JSON.stringify(panelState));
  }
  applyPanelState();

  $("#panel-handle").addEventListener("click", () => {
    panelState.collapsed = !panelState.collapsed;
    applyPanelState();
    savePanelState();
  });
  $("#panel-pin").addEventListener("click", () => {
    panelState.pinned = !panelState.pinned;
    if (panelState.pinned) panelState.collapsed = false;
    applyPanelState();
    savePanelState();
  });
  document.querySelectorAll(".panel-section[data-acc] .acc-head").forEach((head) => {
    head.addEventListener("click", () => {
      const sec = head.closest(".panel-section");
      panelState.closed[sec.dataset.acc] = !sec.classList.contains("closed");
      applyPanelState();
      savePanelState();
    });
  });

  // reset: drop the saved arrangement (of the active structure mode)
  $("#reset-layout").addEventListener("click", () => {
    clearTimeout(saveTimer); // a pending save must not resurrect the old layout
    localStorage.removeItem(anchorsKey());
    location.reload();
  });

  // ── structure switch: reassign clusters, recolor, reorganize animated ──
  function setStructure(mode) {
    if (mode === structureMode || viewTransition) return;
    structureMode = mode;
    localStorage.setItem(STRUCTURE_KEY, mode);
    $("#structure-switch")
      .querySelectorAll("button")
      .forEach((b) => b.classList.toggle("active", b.dataset.structure === mode));
    for (const n of sim.nodes) n.cluster = mode === "blocks" ? n.group : n.baseCluster;
    hues = clusterHues(activeGrouping());
    renderer.setHues(hues);
    renderLegend();
    if (currentView === "ring") {
      // recompute the wheel and fly nodes to their new segments
      const from = new Map(sim.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
      ring = computeRingLayout(sim.nodes, innerWidth, innerHeight);
      for (const [key, c] of sim.centers) {
        const rc = ring.centers.get(key);
        if (rc) {
          c.x = rc.x;
          c.y = rc.y;
        }
      }
      viewTransition = { t0: performance.now(), ms: 950, from, to: ring.positions };
      cloudSnapshot = null; // stale under the new grouping
    } else {
      // clouds reorganize themselves through the physics — animated by nature
      sim.regroup(loadAnchors());
      wasBusy = true;
    }
  }
  $("#structure-switch").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-structure]");
    if (b) setStructure(b.dataset.structure);
  });
  $("#structure-switch")
    .querySelectorAll("button")
    .forEach((b) => b.classList.toggle("active", b.dataset.structure === structureMode));

  // ── minimap ────────────────────────────────────────────────────
  const minimap = createMinimap($("#minimap"), sim, renderer, colorOf, (x, y, s, ms) =>
    interactions.flyTo(x, y, s, ms),
  );

  // ── render loop ────────────────────────────────────────────────
  addEventListener("resize", () => renderer.resize());
  let userTouched = false;
  canvas.addEventListener("pointerdown", () => (userTouched = true));
  canvas.addEventListener("wheel", () => (userTouched = true), { passive: true });
  let warmupFrames = 0;
  let wasBusy = true;
  function frame(now) {
    if (viewTransition) {
      // nodes fly between views; physics pauses while they travel
      const t = Math.min((now - viewTransition.t0) / viewTransition.ms, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      for (const n of sim.nodes) {
        const from = viewTransition.from.get(n.id);
        const to = viewTransition.to.get(n.id);
        if (from && to) {
          n.x = from.x + (to.x - from.x) * e;
          n.y = from.y + (to.y - from.y) * e;
        }
      }
      if (t >= 1) {
        viewTransition = null;
        interactions.fitAll();
      }
    } else if (currentView === "clouds") {
      const busy = sim.tick();
      if (busy && warmupFrames++ === 24 && !userTouched) interactions.fitAll();
      if (!busy && wasBusy && !userTouched) interactions.fitAll(); // settled → final framing
      wasBusy = busy;
      // safety distance between clouds — evading clouds glide away, animated;
      // persist the arrangement once everything has come to rest
      if (sim.separateClouds(interactions.draggedCluster())) saveAnchorsSoon();
    }
    interactions.step(now);
    renderer.draw(now);
    minimap.draw();
    requestAnimationFrame(frame);
  }
  interactions.fitAll();
  requestAnimationFrame(frame);
  if (localStorage.getItem(VIEW_KEY) === "ring") switchView("ring");

  setTimeout(() => $("#hint").classList.add("fade"), 6000);
}

main().catch((err) => {
  const hint = document.querySelector("#hint");
  hint.textContent = `could not load the vault graph — is the daemon running? (${err.message})`;
  hint.classList.remove("fade");
});
