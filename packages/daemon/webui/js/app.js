/** Bootstrap: load the graph, wire theme/search/inspector/panel, run the
 *  render loop. Theme default follows prefers-color-scheme; the toggle
 *  persists to localStorage and re-reads the --map-* palette so the canvas
 *  recolors with the chrome. */

import { fetchGraph, fetchHealth, fetchAnnotations, postAnnotation, fetchSemanticSearch, clusterHues, clusterColor } from "./graph-data.js";
import { createSimulation } from "./simulation.js";
import { createRenderer } from "./renderer.js";
import { createInteractions } from "./interactions.js";
import { createInspector } from "./inspector.js";
import { createSearch } from "./search.js";
import { createMinimap } from "./minimap.js";
import { createRingView } from "./managers/ring-view.js";
import { createSemanticView } from "./managers/semantic-view.js";
import { createSearchChat } from "./managers/search-chat.js";
import { createImportDialog } from "./managers/import-dialog.js";

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
  // All ring internals (decor, drill browser, emblem, band hit tests) live
  // in the ring-view manager; this file only orchestrates the switch and
  // owns the node-position transition.
  const VIEW_KEY = "bastra-vault-map-view";
  // the structure a view opens with: clouds carry the fine clusters, the
  // ring reads best in the six building blocks. The semantic view has no
  // structure choice at all — positions are meaning, grouping only recolors,
  // so it stays pinned to the readable block palette (switch hidden there).
  const VIEW_STRUCTURE = { clouds: "clusters", ring: "blocks", semantic: "blocks" };
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
      if (clusterFilter) {
        clusterFilter = null; // its match belongs to the previous scope
        applyFilter();
      }
      renderDrillSwitcher(state);
      renderLegend();
      renderSignals();
    },
  });
  let drillScope = null; // active drill state (both modes) for sidebar scoping
  const visibleNodes = () => sim.nodes.filter((n) => !n.ringHidden);

  const semanticView = createSemanticView({ sim, renderer });

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
    // every view opens in its default structure — BEFORE the enter, so the
    // ring computes its wheel over the right grouping
    if (structureMode !== VIEW_STRUCTURE[v]) applyStructure(VIEW_STRUCTURE[v]);
    $("#structure-label").hidden = $("#structure-switch").hidden = v === "semantic";
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
    if (node && clusterFilter) {
      clusterFilter = null;
      applyFilter();
      renderLegend();
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

  // ── legend + panels ────────────────────────────────────────────
  const legendEl = $("#legend");
  let clusterFilter = null; // { key, match } — the legend's click-toggle filter
  function renderLegend() {
    legendEl.innerHTML = "";
    // inside a drill the legend focuses on the wheel's segments; the numbers
    // and hover/click targets are the drilled area, not the whole vault
    const scoped = drillScope !== null;
    const items = scoped ? drillScope.segments : activeGrouping();
    for (const c of items) {
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
      const match = scoped
        ? (n) => drillScope.matchKey(n) === c.key
        : (n) => n.cluster === c.key;
      li.classList.toggle("active", clusterFilter?.key === c.key);
      li.addEventListener("mouseenter", () => renderer.setHighlight(match, scoped ? null : c.key));
      li.addEventListener("mouseleave", () => renderer.setHighlight(null));
      // click = toggle a persistent cluster filter (ANDed with the other
      // filters): another entry switches over, the same entry releases.
      // Selecting a node on the map releases it too (see select()).
      li.addEventListener("click", () => {
        const on = clusterFilter?.key !== c.key;
        clusterFilter = on ? { key: c.key, match } : null;
        applyFilter();
        renderLegend();
        if (!on) return;
        if (scoped) {
          interactions.flyToBounds(visibleNodes().filter(match), { padding: 80, maxScale: 2.4 });
        } else {
          interactions.flyToCluster(c.key);
        }
      });
      legendEl.append(li);
    }
  }
  renderLegend();

  // ── filters: clickable signals + time range, combined with AND ──
  let signalKey = null; // "memories" | "ghosts" | "bridges" | "care" | null
  let timeDays = null; // 7 | 30 | 90 | null
  function applyFilter() {
    if (signalKey === null && timeDays === null && clusterFilter === null) {
      renderer.setFilter(null);
      return;
    }
    const cutoff = timeDays
      ? new Date(Date.now() - timeDays * 86400e3).toISOString().slice(0, 10)
      : null;
    renderer.setFilter((n) => {
      if (clusterFilter !== null && !clusterFilter.match(n)) return false;
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

  function renderSignals() {
    // signals always describe what is ON the map right now — inside a drill
    // that is the drilled area, not the whole vault
    const vis = visibleNodes();
    const visIds = new Set(vis.map((n) => n.id));
    const ghosts = vis.filter((n) => n.kind === "ghost").length;
    const bridges = vis.filter((n) => n.bridge).length;
    const edges = sim.edges.filter((e) => visIds.has(e.s.id) && visIds.has(e.t.id)).length;
    const care = vis.filter((n) => hasOpenCare(n.id)).length;
    const rows = [
      { key: "memories", label: "memories", value: vis.length - ghosts },
      { key: null, label: "connections", value: edges },
      { key: "ghosts", label: "unwritten notes", value: ghosts },
      { key: "bridges", label: "bridge nodes", value: bridges },
      { key: "care", label: "care flags", value: care },
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
    // prefill the bug-report form with the same sanitized block `bastra
    // feedback bug` sends — version/OS/embedding/vault size, never content
    const diag = [
      `version:    ${h.version}`,
      `os:         ${navigator.platform}`,
      `embedding:  ${h.embedding_mode}`,
      `vault_size: ${h.vault_size}`,
      `via:        vault map`,
    ].join("\n");
    const params = new URLSearchParams({
      template: "bug_report.yml",
      "bastra-version": h.version,
      os: navigator.platform,
      "doctor-output": diag,
    });
    $("#feedback-bug").href = `https://github.com/n0mad-ai/bastra-recall/issues/new?${params.toString()}`;
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
    if (clusterFilter) {
      clusterFilter = null; // its keys belong to the previous grouping
      applyFilter();
    }
    renderLegend();
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
  const savedView = localStorage.getItem(VIEW_KEY);
  if (savedView === "ring" || savedView === "semantic") void switchView(savedView);

  setTimeout(() => $("#hint").classList.add("fade"), 6000);
}

main().catch((err) => {
  const hint = document.querySelector("#hint");
  hint.textContent = `could not load the vault graph — is the daemon running? (${err.message})`;
  hint.classList.remove("fade");
});
