/** Live updates (#216) — an on/off live mode for the map: the daemon buffers
 *  freshly saved memories (GET /ui/updates), this manager polls every few
 *  seconds and turns each one into a supernova in the universe view plus a
 *  preview card with a live seconds-since-birth counter.
 *
 *  Toggle lives in the topbar (#live-toggle), state persists in localStorage.
 *  Polling only runs while the toggle is on.
 *
 *  @param {object} deps
 *  @param {object} deps.orbitView          spawnBurst/focusBurst/renderBursts
 *  @param {object} deps.sim                simulation (cluster anchors for flat views)
 *  @param {object} deps.renderer           overlay hook
 *  @param {() => string} deps.getView      current view key
 *  @param {(v: string) => void} deps.switchView  jump to the universe on card click */

import { drawBurstAt, BURST_LIFE } from "./orbit-view.js";

const $ = (sel) => document.querySelector(sel);
const LIVE_KEY = "bastra-vault-map-live";
const POLL_MS = 5000;
const CARD_LIFE_MS = 120000; // matches the burst lifetime
const MAX_CARDS_PER_POLL = 4;

export function createLiveUpdates(deps) {
  const toggle = $("#live-toggle");
  const cardsEl = $("#live-cards");
  let on = (localStorage.getItem(LIVE_KEY) ?? "on") === "on";
  let since = Date.now(); // only memories saved AFTER opening the map count
  let pollTimer = 0;
  let known = new Set(); // ids already announced

  function render() {
    toggle.classList.toggle("on", on);
    toggle.title = on
      ? "Live updates ON — new memories appear as supernovae. Click to turn off."
      : "Live updates OFF — click to watch new memories appear live.";
  }

  function card(entry) {
    const li = document.createElement("div");
    li.className = "live-card";
    const head = document.createElement("div");
    head.className = "live-head";
    const star = document.createElement("span");
    star.className = "live-star";
    star.textContent = "✦";
    const label = document.createElement("span");
    label.className = "live-label";
    label.textContent = "new memory";
    const age = document.createElement("span");
    age.className = "live-age";
    age.dataset.born = String(Date.now());
    age.textContent = "0s";
    const close = document.createElement("button");
    close.className = "live-close";
    close.textContent = "×";
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      li.remove();
    });
    head.append(star, label, age, close);
    const title = document.createElement("div");
    title.className = "live-title";
    title.textContent = entry.title;
    const meta = document.createElement("div");
    meta.className = "live-meta";
    meta.textContent = `${entry.type} · ${entry.cluster}`;
    const summary = document.createElement("div");
    summary.className = "live-summary";
    summary.textContent = entry.summary;
    li.append(head, title, meta, summary);
    li.addEventListener("click", () => {
      const wasOrbit = deps.getView() === "orbit";
      if (!wasOrbit) deps.switchView("orbit");
      // after a view switch the flight needs a beat before refocusing
      setTimeout(() => deps.orbitView.focusBurst(entry.id), wasOrbit ? 0 : 1100);
    });
    cardsEl.prepend(li);
    setTimeout(() => {
      li.classList.add("fade");
      setTimeout(() => li.remove(), 900);
    }, CARD_LIFE_MS);
  }

  // topbar memory counter follows live: +1 per newborn, with a tiny pulse
  function bumpCounter(n) {
    const el = $("#stat-count");
    const cur = parseInt(el.textContent, 10);
    if (Number.isNaN(cur)) return; // health not loaded yet — next reload catches up
    el.textContent = `${cur + n} memories`;
    el.classList.remove("bump");
    void el.offsetWidth; // restart the animation
    el.classList.add("bump");
  }

  function summaryCard(count) {
    const li = document.createElement("div");
    li.className = "live-card";
    const title = document.createElement("div");
    title.className = "live-title";
    title.textContent = `+${count} more new memories`;
    li.append(title);
    cardsEl.prepend(li);
    setTimeout(() => li.remove(), 20000);
  }

  async function poll() {
    if (!on) return;
    try {
      const res = await fetch(`/ui/updates?since=${since}`);
      if (!res.ok) return;
      const data = await res.json();
      since = data.now ?? Date.now();
      const fresh = (data.updates ?? []).filter((u) => !known.has(u.id));
      fresh.forEach((u) => known.add(u.id));
      for (const u of fresh.slice(0, MAX_CARDS_PER_POLL)) {
        deps.orbitView.spawnBurst(u);
        card(u);
      }
      if (fresh.length > MAX_CARDS_PER_POLL) summaryCard(fresh.length - MAX_CARDS_PER_POLL);
      if (fresh.length > 0) bumpCounter(fresh.length);
    } catch {
      // daemon briefly away — next poll retries
    }
  }

  function arm() {
    clearInterval(pollTimer);
    if (on) pollTimer = setInterval(poll, POLL_MS);
  }

  toggle.addEventListener("click", () => {
    on = !on;
    localStorage.setItem(LIVE_KEY, on ? "on" : "off");
    if (on) since = Date.now(); // don't backfill what happened while off
    render();
    arm();
  });

  // live seconds counter on every visible card, once per second
  setInterval(() => {
    for (const el of cardsEl.querySelectorAll(".live-age")) {
      el.textContent = `${Math.floor((Date.now() - Number(el.dataset.born)) / 1000)}s`;
    }
  }, 1000);

  // ── the burst overlay: supernovae in EVERY view, drawn above the nodes.
  // Universe view projects the true 3D position; the flat views anchor the
  // burst on a node of the memory's area (its cloud/wedge), slightly above.
  deps.renderer.setOverlay((ctx, camera, theme, now) => {
    if (deps.getView() === "orbit") {
      deps.orbitView.renderBursts(ctx, camera, theme, now);
      return;
    }
    for (const b of deps.orbitView.listBursts()) {
      const age = (now - b.born) / 1000;
      if (age > BURST_LIFE) continue;
      const anchor = deps.sim.nodes.find(
        (n) => (n.baseCluster === b.cluster || n.cluster === b.cluster) && !n.ringHidden,
      );
      if (!anchor) continue;
      drawBurstAt(ctx, camera, theme, anchor.x, anchor.y - 16, 1, age);
    }
  });

  render();
  arm();
}
