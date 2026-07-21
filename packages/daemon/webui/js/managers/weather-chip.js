/** Weather chip + place picker (#217) — the topbar face of managers/weather.js.
 *  That module owns the data (place, conditions, the three services); this one
 *  owns the pixels and never fetches anything itself.
 *
 *  The chip is the FIRST element in .topbar-right and it is the only way in:
 *  weather is off until a place is chosen here, so opting in is a deliberate
 *  act with a visible result rather than a switch whose effect you have to
 *  hunt for on the map.
 *
 *  Picker layout is deliberate: GPS and search are shown TOGETHER, always.
 *  A fix can be missing, refused, or plain wrong (VPN, desktop, a laptop that
 *  believes it lives in a datacenter), so the search box is never gated behind
 *  a GPS failure — and it stays reachable afterwards to correct a bad fix.
 *
 *  @param {object} deps
 *  @param {object} deps.weather  the weather manager (data layer) */

const $ = (sel) => document.querySelector(sel);
const SEARCH_DEBOUNCE_MS = 300; // one request per pause in typing, not per key

/** Condition → inline SVG path set. Kept here rather than in index.html: the
 *  icon IS the reading, so it has to change with the conditions. */
const ICONS = {
  clear: '<circle cx="12" cy="12" r="4.6" fill="none" stroke="currentColor" stroke-width="2"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="2" x2="12" y2="4.4"/><line x1="12" y1="19.6" x2="12" y2="22"/><line x1="2" y1="12" x2="4.4" y2="12"/><line x1="19.6" y1="12" x2="22" y2="12"/><line x1="5" y1="5" x2="6.7" y2="6.7"/><line x1="17.3" y1="17.3" x2="19" y2="19"/><line x1="19" y1="5" x2="17.3" y2="6.7"/><line x1="6.7" y1="17.3" x2="5" y2="19"/></g>',
  partial:
    '<circle cx="9" cy="9" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 19.5a3.6 3.6 0 0 1 .5-7.16 5 5 0 0 1 9.6 1.36A3.1 3.1 0 0 1 17.6 19.5H8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  cloudy:
    '<path d="M7 18.5a4 4 0 0 1 .55-7.96 5.5 5.5 0 0 1 10.55 1.5A3.48 3.48 0 0 1 17.5 18.5H7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  rain: '<path d="M7 15.5a4 4 0 0 1 .55-7.96 5.5 5.5 0 0 1 10.55 1.5A3.48 3.48 0 0 1 17.5 15.5H7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="9" y1="18" x2="8" y2="21"/><line x1="13" y1="18" x2="12" y2="21"/><line x1="17" y1="18" x2="16" y2="21"/></g>',
  storm:
    '<path d="M7 14.5a4 4 0 0 1 .55-7.96 5.5 5.5 0 0 1 10.55 1.5A3.48 3.48 0 0 1 17.5 14.5H7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13 16l-3 4h3l-1 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
  snow: '<path d="M7 15.5a4 4 0 0 1 .55-7.96 5.5 5.5 0 0 1 10.55 1.5A3.48 3.48 0 0 1 17.5 15.5H7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="9" y1="18.5" x2="9" y2="21"/><line x1="13" y1="18.5" x2="13" y2="21"/><line x1="17" y1="18.5" x2="17" y2="21"/></g>',
  fog: '<g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="6" y1="13" x2="18" y2="13"/><line x1="4" y1="17" x2="16" y2="17"/></g>',
};
const ICON_FOR = {
  clear: "clear", partly: "partial", cloudy: "cloudy",
  rain: "rain", storm: "storm", snow: "snow", fog: "fog",
};

export function createWeatherChip({ weather }) {
  const chip = $("#weather-chip");
  const readout = $("#weather-readout");
  const icon = $("#weather-icon");
  const picker = $("#weather-picker");
  const gpsBtn = $("#wp-gps");
  const searchInput = $("#wp-search");
  const results = $("#wp-results");
  const note = $("#wp-note");
  const current = $("#wp-current");
  const currentName = $("#wp-current-name");
  let searchTimer = 0;

  function render() {
    const r = weather.readout();
    chip.classList.toggle("on", weather.isOn());
    icon.innerHTML = ICONS[ICON_FOR[r?.icon ?? "clear"]] ?? ICONS.cloudy;

    if (!r) {
      readout.hidden = true;
      readout.textContent = "";
      chip.title = "Local weather — off. Pick a place to tint the mindspace.";
    } else {
      // temperature and place LEFT of the icon; the icon carries the condition,
      // so the reading needs no second symbol
      readout.hidden = false;
      readout.innerHTML = "";
      if (r.temp !== null) {
        const t = document.createElement("span");
        t.className = "wr-temp";
        t.textContent = `${r.temp}°`;
        readout.append(t, " ");
      }
      const p = document.createElement("span");
      p.className = "wr-place";
      p.textContent = r.place;
      readout.append(p);
      const status = weather.status();
      chip.title =
        `${r.place}${status ? ` — ${status}` : ""}. Position rounded to ~11 km, ` +
        `sent only to the weather service. Click to change or turn off.`;
    }

    const place = weather.getPlace();
    current.hidden = !place;
    if (place) currentName.textContent = place.name;
  }

  function openPicker(open) {
    picker.hidden = !open;
    chip.setAttribute("aria-expanded", String(open));
    if (open) {
      note.textContent = "";
      searchInput.focus();
    }
  }

  function renderResults(list) {
    results.replaceChildren(
      ...list.map((p) => {
        const li = document.createElement("li");
        li.textContent = p.name;
        if (p.detail) {
          const d = document.createElement("span");
          d.className = "wr-detail";
          d.textContent = p.detail;
          li.append(d);
        }
        li.addEventListener("click", async () => {
          await weather.setPlace(p);
          results.replaceChildren();
          searchInput.value = "";
          openPicker(false);
        });
        return li;
      }),
    );
  }

  chip.addEventListener("click", (ev) => {
    ev.stopPropagation();
    openPicker(picker.hidden);
  });
  picker.addEventListener("click", (ev) => ev.stopPropagation());
  // click-away and Escape both close it — a popover that only closes via its
  // own trigger is a trap
  document.addEventListener("click", () => {
    if (!picker.hidden) openPicker(false);
  });
  addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !picker.hidden) openPicker(false);
  });

  gpsBtn.addEventListener("click", async () => {
    gpsBtn.classList.add("busy");
    note.textContent = "asking the browser for your location…";
    try {
      await weather.useGps();
      openPicker(false);
    } catch (err) {
      // never a dead end: the message names the search box right below it
      note.textContent = err.message;
    } finally {
      gpsBtn.classList.remove("busy");
    }
  });

  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = searchInput.value;
    if (q.trim().length < 2) {
      results.replaceChildren();
      return;
    }
    searchTimer = setTimeout(async () => {
      const list = await weather.search(q);
      renderResults(list);
      note.textContent = list.length === 0 ? "nothing found — try another spelling" : "";
    }, SEARCH_DEBOUNCE_MS);
  });

  $("#wp-clear").addEventListener("click", async () => {
    await weather.clear();
    openPicker(false);
  });

  render();
  return { render };
}
