/** Bootstrap: load the graph, wire theme/search/inspector/panel, run the
 *  render loop. Theme default follows prefers-color-scheme; the toggle
 *  persists to localStorage and re-reads the --map-* palette so the canvas
 *  recolors with the chrome. */

import { fetchGraph, fetchAnnotations, postAnnotation, fetchSemanticSearch, fetchNode, clusterHues, clusterColor, nodeRadius } from "./graph-data.js";
import { createSimulation } from "./simulation.js";
import { createRenderer } from "./renderer.js";
import { createInteractions } from "./interactions.js";
import { createInspector } from "./inspector.js";
import { createSearch } from "./search.js";
import { createMinimap } from "./minimap.js";
import { createRingView } from "./managers/ring-view.js";
import { createSemanticView } from "./managers/semantic-view.js";
import { createOrbitView } from "./managers/orbit-view.js";
import { createSearchChat } from "./managers/search-chat.js";
import { createImportDialog } from "./managers/import-dialog.js";
import { createOnboardingDialog } from "./managers/onboarding-dialog.js";
import { createAreasManager } from "./managers/areas-manager.js";
import { createLiveUpdates } from "./managers/live-updates.js";
import { createSidebarPanels } from "./managers/sidebar-panels.js";
import { createViewControls } from "./managers/view-controls.js";
import { createWeather } from "./managers/weather.js";
import { createWeatherChip } from "./managers/weather-chip.js";

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
  // A display model, not a view — but each view opens with the structure it
  // reads best in: clouds fine-grained, ring/semantic in building blocks.
  let structureMode = "clusters"; // clouds default; view switches re-apply
  for (const n of graph.nodes) n.baseCluster = n.cluster; // fine layer, kept
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
    panels.renderLegend(); // legend dots follow the theme's ink
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
      panels.renderSignals();
    },
    onNavigate: (id) => {
      const n = sim.byId.get(id);
      if (n) select(n, true);
    },
  });

  // ── views: clouds (force layout) ↔ ring (computed wheel) ───────
  // All ring internals (decor, drill browser, emblem, band hit tests) live
  // in the ring-view manager; this file only orchestrates the switch and
  // owns the node-position transition.
  const VIEW_KEY = "bastra-vault-map-view";
  // the structure a view opens with: clouds carry the fine clusters, the
  // ring reads best in the six building blocks. The semantic view has no
  // structure choice at all — positions are meaning, grouping only recolors,
  // so it stays pinned to the readable block palette (switch hidden there).
  const VIEW_STRUCTURE = { clouds: "clusters", ring: "blocks", semantic: "blocks", orbit: "clusters" };
  let currentView = "clouds";
  let viewTransition = null; // { t0, ms, from, to, noFit?, done? }
  let cloudSnapshot = null; // node positions to return to

  const ringView = createRingView({
    sim,
    renderer,
    graph,
    getInteractions: () => interactions,
    getHues: () => hues,
    getSatLight: () => [sat, light],
    getStructureMode: () => structureMode,
    startTransition: (from, to) => {
      viewTransition = { t0: performance.now(), ms: 950, from, to, noFit: true };
    },
    onDrillChange: (state) => {
      drillScope = state; // legend + signals focus on the drilled area
      panels.clearClusterFilter(); // its match belongs to the previous scope
      renderDrillSwitcher(state);
      panels.renderLegend();
      panels.renderSignals();
    },
  });
  let drillScope = null; // active drill state (both modes) for sidebar scoping
  const visibleNodes = () => sim.nodes.filter((n) => !n.ringHidden);

  const semanticView = createSemanticView({ sim, renderer, getInteractions: () => interactions });
  // Weather layer (#217): opt-in, off by default. Nothing is requested until
  // the user picks a place in the topbar chip. The callback goes through a
  // variable because the chip manager is created after the views it feeds;
  // touching a `const` from up here would be a TDZ error, which optional
  // chaining does NOT catch.
  let onWeatherChange = () => {};
  const weather = createWeather(() => onWeatherChange());

  const orbitView = createOrbitView({
    sim,
    renderer,
    getInteractions: () => interactions,
    getHues: () => hues,
    getSatLight: () => [sat, light],
    getWeather: () => weather.get(),
  });

  // ── drill switcher (sidebar): appears for instance-mode areas like
  // PROJECTS. Revealed AFTER the wheel's fan-out settles, with a short
  // attention pulse that pulls the eye over — "there's more to switch here".
  let lastDrillState = null;
  let drillRevealTimer = 0;
  function renderDrillSwitcher(state) {
    const sec = $("#drill-section");
    const wasHidden = sec.hidden;
    clearTimeout(drillRevealTimer);
    lastDrillState = state && state.mode === "instance" ? state : null;
    if (!lastDrillState) {
      sec.hidden = true;
      sec.classList.remove("attention");
      return;
    }
    $("#drill-title").textContent = lastDrillState.area;
    $("#drill-active").textContent = lastDrillState.active;
    const ul = $("#drill-list");
    ul.innerHTML = "";
    for (const inst of lastDrillState.instances) {
      const li = document.createElement("li");
      if (inst.key === lastDrillState.active) li.className = "active";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = inst.key;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = inst.count;
      li.append(name, count);
      li.addEventListener("click", () => ringView.switchInstance(inst.key));
      ul.append(li);
    }
    if (wasHidden) {
      drillRevealTimer = setTimeout(() => {
        sec.hidden = false;
        sec.classList.add("attention");
        setTimeout(() => sec.classList.remove("attention"), 2600);
      }, 1000);
    }
  }
  function stepInstance(dir) {
    if (!lastDrillState) return;
    const list = lastDrillState.instances;
    const idx = list.findIndex((i) => i.key === lastDrillState.active);
    const next = list[(idx + dir + list.length) % list.length];
    ringView.switchInstance(next.key);
  }
  $("#drill-prev").addEventListener("click", () => stepInstance(-1));
  $("#drill-next").addEventListener("click", () => stepInstance(1));

  let viewLoading = false; // semantic layout fetch in flight — don't re-enter
  async function switchView(v) {
    if (v === currentView || viewTransition || viewLoading) return;
    // fetch the semantic layout first — it can fail (no embeddings yet),
    // and then the current view must stay untouched
    let semTargets = null;
    if (v === "semantic") {
      viewLoading = true;
      try {
        semTargets = await semanticView.enter();
      } catch (err) {
        const hint = $("#hint");
        hint.textContent = `semantic view unavailable — ${err.message}`;
        hint.classList.remove("fade");
        setTimeout(() => hint.classList.add("fade"), 5000);
        return;
      } finally {
        viewLoading = false;
      }
    }
    // capture AFTER any await — the clouds keep drifting while the layout
    // loads, and a stale snapshot would snap them back at flight start
    const from = new Map(sim.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    let to;
    if (currentView === "clouds") cloudSnapshot = from;
    if (currentView === "ring") ringView.exit();
    if (currentView === "semantic") semanticView.exit();
    if (currentView === "orbit") orbitView.exit();
    // every view opens in its default structure — BEFORE the enter, so the
    // ring computes its wheel over the right grouping
    if (structureMode !== VIEW_STRUCTURE[v]) applyStructure(VIEW_STRUCTURE[v]);
    $("#structure-label").hidden = $("#structure-switch").hidden = v === "semantic" || v === "orbit";
    // semantic: an der Structure-Stelle sitzt stattdessen der 2D/3D-Umschalter
    $("#semantic-mode-label").hidden = $("#semantic-mode-switch").hidden = v !== "semantic";
    if (v === "semantic") viewControls.renderSemanticModeSwitch();
    // orbit: universe/galactic-Umschalter + Galaxie-Optionen (Distance, Drift)
    viewControls.renderMindspaceControls(v);
    if (v === "ring") {
      to = ringView.enter(); // glides its own camera via flyToRing
    } else if (v === "clouds") {
      // settle the clouds OFF-SCREEN: start from the last arrangement,
      // re-anchor for the active grouping, run the physics to rest — the
      // flight target IS the final layout, so the landing hands over to the
      // live physics seamlessly instead of snapping
      for (const n of sim.nodes) {
        const p = cloudSnapshot?.get(n.id);
        if (p) {
          n.x = p.x;
          n.y = p.y;
        }
        n.vx = 0;
        n.vy = 0;
      }
      sim.regroup(loadAnchors());
      for (let i = 0; i < 220 && sim.tick(); i++);
      to = new Map(sim.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
      userTouched = false; // allow the settled layout to claim the camera
      warmupFrames = 25; // the boot-warmup snap-fit must never fire again
      wasBusy = true;
    } else if (v === "orbit") {
      to = orbitView.enter();
    } else {
      to = semTargets;
      void semanticView.enter(); // re-arm the flags a ring exit reset; cached → sync
    }
    if (v !== "ring") {
      // camera glides to the new layout WHILE the nodes fly — never an end
      // snap. Same padding/cap as fitAll, so a later settle-fit is a no-op.
      interactions.flyToBounds([...to.values()], { padding: 90, maxScale: 1.6, ms: 950 });
    }
    currentView = v;
    localStorage.setItem(VIEW_KEY, v);
    $("#view-switch")
      .querySelectorAll("button")
      .forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    viewTransition = { t0: performance.now(), ms: 950, from, to, noFit: true };
  }

  $("#view-switch").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-view]");
    if (b) void switchView(b.dataset.view);
  });

  /** Neighborhood of a node: itself + everything it connects to — including
   *  the unwritten connections while the semantic view is showing them. */
  function neighborhoodOf(node) {
    const pts = [node];
    const lists = currentView === "semantic" ? [sim.edges, semanticView.getEdges()] : [sim.edges];
    for (const list of lists) {
      for (const e of list) {
        if (e.s.id === node.id) pts.push(e.t);
        if (e.t.id === node.id) pts.push(e.s);
      }
    }
    return pts;
  }

  function select(node, fly = true) {
    // a stale hover (mouse parked over the canvas since before the search)
    // would win over the new focus and light up the WRONG node's strands
    renderer.setHover(null);
    // picking a memory ends the cluster-filter lens — the selection's own
    // neighborhood lighting takes over, undimmed
    if (node && panels.clearClusterFilter()) {
      panels.renderLegend();
    }
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

  /** Live-Lane (#216/#217): Memory öffnen, auch wenn es erst NACH dem
   *  Seiten-Load geboren wurde — dann existiert noch kein Sim-Node und der
   *  Inspector bekommt den frisch gefetchten Node direkt. */
  async function openMemoryById(id) {
    const n = sim.byId.get(id);
    if (n) {
      select(n);
      return;
    }
    try {
      const full = await fetchNode(id);
      document.body.classList.add("inspector-open");
      inspector.show({ kind: "memory", ...full });
    } catch {
      // noch nicht indexiert — der nächste Klick nach dem Reload trifft
    }
  }

  /** Live-Lane (#217): Newborn als ECHTEN Sim-Node adoptieren, sobald die
   *  Supernova erscheint — klickbar, hoverbar, glüht mit Valenz, und bleibt
   *  nach dem Verglühen an Ort und Stelle (kein Reload nötig). */
  function adoptLiveNode(u) {
    if (sim.byId.has(u.id)) return;
    const anchor = sim.centers.get(u.cluster);
    const node = {
      id: u.id,
      title: u.title,
      type: u.type,
      scope: u.scope ?? u.cluster,
      cluster: u.cluster,
      baseCluster: u.cluster,
      group: "other",
      sub: "general",
      tags: [],
      summary: u.summary,
      updated: new Date().toISOString().slice(0, 10),
      degree: 0,
      kind: u.type === "doc" ? "doc" : "memory",
      ...(typeof u.salience === "number" ? { salience: u.salience } : {}),
      ...(u.emotion ? { emotion: u.emotion } : {}),
      x: (anchor?.x ?? innerWidth / 2) + (Math.random() - 0.5) * 40,
      y: (anchor?.y ?? innerHeight / 2) + (Math.random() - 0.5) * 40,
      vx: 0,
      vy: 0,
      idx: sim.nodes.length,
    };
    node.cr = nodeRadius(node) + 3.5;
    sim.nodes.push(node);
    sim.byId.set(u.id, node);
    sim.reheat?.();
  }

  /** Screen areas covered by UI — fits/flights center in the free rectangle. */
  function mapInsets() {
    const inspectorOpen = !$("#inspector").hidden || document.body.classList.contains("inspector-open");
    // panel state lives in sidebar-panels.js — its applyPanelState() mirrors
    // visibility onto the body class, which is order-safe during boot
    const panelVisible = document.body.classList.contains("panel-open");
    return {
      left: inspectorOpen ? 432 : 24,
      right: panelVisible ? 286 : 46,
      top: 70,
      bottom: 40,
    };
  }

  const interactions = createInteractions(canvas, renderer, sim, {
    onSelect: (n, sx, sy) => {
      // universe: solange eine Supernova brennt, gewinnt ihr Stern jeden
      // Klick in seinem Radius — sonst öffnet der Node-Pick den nächsten
      // ÜBERLAPPENDEN Nachbarn statt des Newborns unter dem Stern
      if (currentView === "orbit" && sx !== undefined) {
        const w = renderer.toWorld(sx, sy);
        const burst = orbitView.pickBurst(w.x, w.y);
        if (burst) {
          void openMemoryById(burst.id);
          return;
        }
      }
      if (n) {
        select(n);
        return;
      }
      // ring view: headline = back, center = image picker, band = drill in
      if (currentView === "ring" && sx !== undefined) {
        if (ringView.handleClick(renderer.toWorld(sx, sy))) return;
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
        // clickable ring chrome gets a pointer: band segments (drill in),
        // headline (back), center emblem (image picker)
        if (currentView === "ring") {
          if (ringView.updateHover(renderer.toWorld(x, y))) canvas.style.cursor = "pointer";
        } else {
          ringView.clearHover();
        }
        // Live-Supernovae sind klickbar → Zeigefinger auch über dem Stern
        if (currentView === "orbit") {
          const w = renderer.toWorld(x, y);
          if (orbitView.pickBurst(w.x, w.y)) canvas.style.cursor = "pointer";
        }
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
    if (ev.key !== "Escape") return;
    if (inspector.isOpen()) select(null);
    else if (ringView.isDrilled()) ringView.drillOut(); // Esc backs out of the area
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

  // ── search: instant title match + the daemon's semantic recall.
  // While the search is open the map dims/blurs, the box widens, and the
  // copilot chat docks beside the results to deepen the search.
  const searchApi = createSearch($("#search"), $("#search-results"), sim.nodes, {
    colorOf,
    onPick: (n) => select(n, true),
    aiSearch: async (q) =>
      (await fetchSemanticSearch(q)).map((h) => sim.byId.get(h.id)).filter(Boolean),
    onOpenChange: (open) => {
      $("#search-dim").classList.toggle("on", open);
      $("#searchbox").classList.toggle("expanded", open);
      searchChat.setVisible(open);
    },
  });
  const searchChat = createSearchChat({
    panel: $("#search-chat"),
    sim,
    onHits: (found) => searchApi.setAgentHits(found),
  });

  // ── import dialog: seed the vault from other AI tools, visually ──
  createImportDialog({ modal: $("#import-modal"), opener: $("#import-open") });

  // ── areas manager: create/rename/delete the vault's top-level areas ──
  createAreasManager({ modal: $("#areas-modal"), opener: $("#areas-open") });

  // ── live updates: new memories appear as supernovae + preview cards ──
  createLiveUpdates({
    orbitView,
    sim,
    renderer,
    getView: () => currentView,
    switchView,
    openMemory: openMemoryById,
    adoptNode: adoptLiveNode,
  });

  // ── mindspace recenter: one press (or C) fits the universe back in view ──
  function recenterOrbit() {
    if (currentView !== "orbit") return;
    interactions.flyToBounds(sim.nodes.map((n) => ({ x: n.x, y: n.y })), { padding: 90, maxScale: 1.6, ms: 700 });
  }
  $("#orbit-recenter").addEventListener("click", recenterOrbit);
  addEventListener("keydown", (ev) => {
    if (ev.target.matches?.("input, textarea")) return;
    if (ev.key === "c" || ev.key === "C") recenterOrbit();
  });

  // ── onboarding interview: a fresh vault offers to seed itself ──
  createOnboardingDialog({ modal: $("#onboarding-modal") });

  // ── sidebar panels: legend, signals, filters, system, panel state ──
  const panels = createSidebarPanels({
    sim,
    renderer,
    graph,
    getInteractions: () => interactions,
    getHues: () => hues,
    getSatLight: () => [sat, light],
    getDrillScope: () => drillScope,
    activeGrouping,
    visibleNodes,
    hasOpenCare,
  });

  // reset: drop the saved arrangement (of the active structure mode)
  $("#reset-layout").addEventListener("click", () => {
    clearTimeout(saveTimer); // a pending save must not resurrect the old layout
    localStorage.removeItem(anchorsKey());
    location.reload();
  });

  // ── structure switch: reassign clusters, recolor, reorganize animated ──
  /** Reassign + recolor only — no re-layout. View switches use this to apply
   *  their default structure before computing the target layout. */
  function applyStructure(mode) {
    structureMode = mode;
    $("#structure-switch")
      .querySelectorAll("button")
      .forEach((b) => b.classList.toggle("active", b.dataset.structure === mode));
    for (const n of sim.nodes) n.cluster = mode === "blocks" ? n.group : n.baseCluster;
    hues = clusterHues(activeGrouping());
    renderer.setHues(hues);
    panels.clearClusterFilter(); // its keys belong to the previous grouping
    panels.renderLegend();
  }
  function setStructure(mode) {
    if (mode === structureMode || viewTransition) return;
    applyStructure(mode);
    if (currentView === "ring") {
      // structure change resets any drill and recomputes the whole wheel
      const { from, to } = ringView.refreshForStructure();
      viewTransition = { t0: performance.now(), ms: 950, from, to, noFit: true };
      cloudSnapshot = null; // stale under the new grouping
    } else if (currentView === "clouds") {
      // clouds reorganize themselves through the physics — animated by nature
      sim.regroup(loadAnchors());
      wasBusy = true;
    }
  }
  // ── view controls: semantic + mindspace mode switches (own manager) ──
  const viewControls = createViewControls({
    sim,
    semanticView,
    orbitView,
    weather,
    getInteractions: () => interactions,
    getCurrentView: () => currentView,
    isBusy: () => Boolean(viewTransition),
    setTransition: (t) => (viewTransition = t),
  });
  const weatherChip = createWeatherChip({ weather });
  onWeatherChange = () => weatherChip.render();

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
        const { done, noFit } = viewTransition;
        viewTransition = null;
        if (!noFit) interactions.fitAll();
        done?.();
      }
    }
    // fan-out crossfade: the non-drilled areas dissolve/reappear in place
    ringView.tick(now);
    // orbit view: rotation + depth projection, paused during view flights
    if (!viewTransition && currentView === "orbit") orbitView.tick(now);
    if (!viewTransition && currentView === "semantic") semanticView.tick(now);
    // clouds physics pauses while any fly/fan-out animation is running
    if (!viewTransition && !ringView.isAnimating() && currentView === "clouds") {
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
  // Mindspace (the universe) is the home view — first visit lands there;
  // afterwards the last-used view wins as before
  const savedView = localStorage.getItem(VIEW_KEY) ?? "orbit";
  if (savedView === "ring" || savedView === "semantic" || savedView === "orbit") void switchView(savedView);

  setTimeout(() => $("#hint").classList.add("fade"), 6000);
}

main().catch((err) => {
  const hint = document.querySelector("#hint");
  hint.textContent = `could not load the vault graph — is the daemon running? (${err.message})`;
  hint.classList.remove("fade");
});
