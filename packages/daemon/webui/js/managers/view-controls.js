/** View controls — the sidebar's per-view mode switches: Semantic flat/depth
 *  and Mindspace universe/galactic (+ distance/drift options). Split out of
 *  app.js (file-size convention). app.js calls the two render functions on
 *  every view switch; the click handlers live here with the views they steer. */

const $ = (sel) => document.querySelector(sel);

export function createViewControls(deps) {
  const {
    sim,
    semanticView,
    orbitView,
    getInteractions,
    getCurrentView,
    isBusy,
    setTransition,
  } = deps;

  // Semantic 2D/3D (zzallirog): dritter PCA-Kanal + vorhandene Kamera. Der
  // Umschalter sitzt an der Structure-Stelle, die im Semantic-View frei ist.
  function renderSemanticModeSwitch() {
    const m = semanticView.getMode();
    $("#semantic-mode-switch")
      .querySelectorAll("button")
      .forEach((b) => b.classList.toggle("active", b.dataset.smode === m));
  }
  $("#semantic-mode-switch").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-smode]");
    if (!b || getCurrentView() !== "semantic" || isBusy()) return;
    if (b.dataset.smode === semanticView.getMode()) return;
    const from = new Map(sim.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    semanticView.setMode(b.dataset.smode);
    renderSemanticModeSwitch();
    const to = semanticView.targetsForMode(b.dataset.smode);
    getInteractions().flyToBounds([...to.values()], { padding: 90, maxScale: 1.6, ms: 700 });
    setTransition({ t0: performance.now(), ms: 700, from, to, noFit: true });
  });


  // ── Mindspace-Modus: universe (Default) / galactic — plus Galaxie-Optionen.
  // Der galaktische Umbau (User-Wolke als schwarzes Loch im Zentrum) ist
  // OPT-IN; Distance und Drift sind Anzeigeoptionen darunter.
  function renderMindspaceControls(v = getCurrentView()) {
    const inOrbit = v === "orbit";
    $("#mindspace-mode-label").hidden = $("#mindspace-mode-switch").hidden = !inOrbit;
    $("#mindspace-galaxy-opts").hidden = !inOrbit || orbitView.getMode() !== "galaxy";
    $("#mindspace-mode-switch")
      .querySelectorAll("button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mmode === orbitView.getMode()));
    $("#mindspace-distance-switch")
      .querySelectorAll("button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mdist === orbitView.getDistanceMode()));
    $("#mindspace-drift-switch")
      .querySelectorAll("button")
      .forEach((b) => b.classList.toggle("active", b.dataset.mdrift === (orbitView.getDrift() ? "on" : "off")));
  }
  $("#mindspace-mode-switch").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-mmode]");
    if (!b || getCurrentView() !== "orbit" || isBusy()) return;
    if (b.dataset.mmode === orbitView.getMode()) return;
    orbitView.setMode(b.dataset.mmode);
    orbitView.relayout();
    renderMindspaceControls();
  });
  $("#mindspace-distance-switch").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-mdist]");
    if (!b || getCurrentView() !== "orbit" || isBusy()) return;
    if (b.dataset.mdist === orbitView.getDistanceMode()) return;
    orbitView.setDistanceMode(b.dataset.mdist);
    orbitView.relayout();
    renderMindspaceControls();
  });
  $("#mindspace-drift-switch").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-mdrift]");
    if (!b) return;
    orbitView.setDrift(b.dataset.mdrift === "on");
    renderMindspaceControls();
  });


  return { renderSemanticModeSwitch, renderMindspaceControls };
}
