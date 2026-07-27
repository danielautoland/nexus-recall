/** The frame loop: view transitions, per-view ticks, cloud physics, draw.
 *
 *  Split out of app.js (#284). One deliberate difference from a pure move:
 *  the three camera-warmup flags (`userTouched`, `warmupFrames`, `wasBusy`)
 *  now LIVE here instead of in app.js's closure, because the loop is their
 *  only reader. app.js wrote them from two places and both now go through
 *  `claimCameraForNewLayout()` / `markBusy()`.
 *
 *  `viewTransition` stays in app.js and is reached through get/set, the same
 *  accessor pair `view-controls.js` already uses — it is written by five
 *  callers and moving it would be a redesign, not a split.
 */

/**
 * @param {object} deps
 * @param {HTMLCanvasElement} deps.canvas
 * @param {object} deps.sim
 * @param {object} deps.renderer
 * @param {object} deps.minimap
 * @param {object} deps.ringView
 * @param {object} deps.orbitView
 * @param {object} deps.semanticView
 * @param {() => object} deps.getInteractions
 * @param {() => string} deps.getView
 * @param {() => object|null} deps.getTransition
 * @param {(t: object|null) => void} deps.setTransition
 * @param {() => void} deps.saveAnchorsSoon
 */
export function createRenderLoop({
  canvas,
  sim,
  renderer,
  minimap,
  ringView,
  orbitView,
  semanticView,
  getInteractions,
  getView,
  getTransition,
  setTransition,
  saveAnchorsSoon,
}) {
  let userTouched = false;
  let warmupFrames = 0;
  let wasBusy = true;

  addEventListener("resize", () => renderer.resize());
  canvas.addEventListener("pointerdown", () => (userTouched = true));
  canvas.addEventListener("wheel", () => (userTouched = true), { passive: true });

  function frame(now) {
    const interactions = getInteractions();
    const transition = getTransition();
    if (transition) {
      // nodes fly between views; physics pauses while they travel
      const t = Math.min((now - transition.t0) / transition.ms, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      for (const n of sim.nodes) {
        const from = transition.from.get(n.id);
        const to = transition.to.get(n.id);
        if (from && to) {
          n.x = from.x + (to.x - from.x) * e;
          n.y = from.y + (to.y - from.y) * e;
        }
      }
      if (t >= 1) {
        const { done, noFit } = transition;
        setTransition(null);
        if (!noFit) interactions.fitAll();
        done?.();
      }
    }
    const busyTransition = Boolean(getTransition());
    const view = getView();
    // fan-out crossfade: the non-drilled areas dissolve/reappear in place
    ringView.tick(now);
    // orbit view: rotation + depth projection, paused during view flights
    if (!busyTransition && view === "orbit") orbitView.tick(now);
    if (!busyTransition && view === "semantic") semanticView.tick(now);
    // clouds physics pauses while any fly/fan-out animation is running
    if (!busyTransition && !ringView.isAnimating() && view === "clouds") {
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

  return {
    start() {
      getInteractions().fitAll();
      requestAnimationFrame(frame);
    },
    /** A freshly computed layout may claim the camera once: forget that the
     *  user ever grabbed it, and make sure the boot-warmup snap-fit can never
     *  fire again. Called by the clouds branch of switchView. */
    claimCameraForNewLayout() {
      userTouched = false;
      warmupFrames = 25;
      wasBusy = true;
    },
    /** The layout is about to move on its own (regroup) — treat the next
     *  settle as a real settle so the final framing still happens. */
    markBusy() {
      wasBusy = true;
    },
  };
}
