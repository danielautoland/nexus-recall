/** Topbar popovers — View + Activity.
 *
 * Only the open/close behaviour lives here. The controls INSIDE the panels keep
 * their own handlers (view-controls.js, app.js); they were moved in the markup,
 * not rewired, so every id is unchanged.
 *
 * Behaviour matches the weather picker so the two feel like one thing: click to
 * toggle, click-away closes, Escape closes. A popover that only closes via its
 * own button is a trap. Additionally only one panel is open at a time — they
 * sit next to each other, and two open panels would overlap.
 */

const $ = (sel) => document.querySelector(sel);

export function createTopbarPopovers() {
  const panels = [
    { btn: $("#view-opts-btn"), pop: $("#view-opts-pop") },
    { btn: $("#activity-opts-btn"), pop: $("#activity-opts-pop") },
  ].filter((p) => p.btn && p.pop);

  // The weather picker is a third popover in the same corner, and it stops
  // click propagation — so neither side's click-away handler ever hears about
  // the other and both panels would sit open on top of each other. Closing it
  // from here (and listening on its chip directly, which stopPropagation does
  // not prevent) keeps them mutually exclusive without touching weather-chip.js.
  const weatherPicker = $("#weather-picker");
  const weatherChip = $("#weather-chip");
  function closeWeather() {
    if (weatherPicker && !weatherPicker.hidden) {
      weatherPicker.hidden = true;
      weatherChip?.setAttribute("aria-expanded", "false");
    }
  }

  // Positioning is pure CSS (see topbar-popovers.css): the panel is fixed and
  // follows the same body.panel-open / body.panel-pinned rules as #live-lane,
  // so it stays on one line with the topbar buttons and the update cards.
  // Measuring the rail in JS was the earlier bug — collapsed it carries a
  // translateX, and the measured edge put the panel off the window instead.
  function setOpen(target, open) {
    for (const p of panels) {
      const next = p === target && open;
      p.pop.hidden = !next;
      p.btn.setAttribute("aria-expanded", String(next));
    }
    if (open) closeWeather();
  }
  const closeAll = () => setOpen(null, false);

  for (const p of panels) {
    p.btn.addEventListener("click", (ev) => {
      ev.stopPropagation(); // else the document handler closes it again
      setOpen(p, p.pop.hidden);
    });
    // clicks on the controls inside must not bubble out to the close handler
    p.pop.addEventListener("click", (ev) => ev.stopPropagation());
  }
  weatherChip?.addEventListener("click", closeAll);

  document.addEventListener("click", closeAll);
  addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeAll();
  });

  return { closeAll };
}
