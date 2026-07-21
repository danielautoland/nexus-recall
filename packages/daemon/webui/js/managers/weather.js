/** Local weather as an ambient layer over the mindspace (#217) — the map's
 *  backdrop picks up the weather where the user actually sits: rain thickens
 *  the shooting stars, a thunderstorm puts distant flashes at the horizon,
 *  cloud cover and humidity thicken the nebulae.
 *
 *  STRICTLY OPT-IN, default off. Nothing here runs, and no position is ever
 *  requested, until the user turns the switch on — the browser then asks for
 *  the location itself, so the grant is the platform's dialog, not ours.
 *
 *  Privacy, in the order the data flows:
 *    1. The coordinates are rounded to ONE decimal (~11 km) before they leave
 *       this function. Weather at that resolution is identical to weather at
 *       the doorstep; the difference is that ~11 km is a region, not an
 *       address. The precise fix is never stored and never sent.
 *    2. The request goes from the BROWSER to Open-Meteo, not through the
 *       daemon. The daemon stays egress-free, and the call is visible in the
 *       user's own devtools — nothing happens behind the local process.
 *    3. Open-Meteo needs no key, no account, no cookie. There is nothing to
 *       correlate the request with beyond the rounded position itself.
 *    4. Only the position leaves. No memory, no vault content, no id.
 *
 *  Refetched every 15 minutes while on — weather does not move faster, and a
 *  tighter poll would only widen the exposure for nothing.
 *
 *  @param {() => void} onChange  called when the conditions changed */

const WEATHER_KEY = "bastra-vault-map-weather";
const REFRESH_MS = 15 * 60 * 1000;
const COORD_DECIMALS = 1; // ~11 km — a region, never an address
const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/** Neutral conditions — also what a failed lookup falls back to, so a dead
 *  network looks like calm weather instead of breaking the backdrop. */
const CALM = { rain: 0, thunder: 0, clouds: 0, fog: 0, label: "", at: 0 };

/** WMO weather codes → the four dials the decor actually reads. Deliberately
 *  coarse: the backdrop has four expressions, so resolving 28 codes into
 *  anything finer would be precision the renderer throws away.
 *  @see https://open-meteo.com/en/docs — WMO 4677 code table */
function conditionsFrom(code, cloudPct, humidityPct) {
  const c = {
    rain: 0,
    thunder: 0,
    clouds: Math.min((cloudPct ?? 0) / 100, 1),
    fog: 0,
    label: "clear",
    at: Date.now(),
  };
  // Humidity carries the fog undertone even without a fog code — otherwise a
  // muggy, overcast day looks exactly as dry as a clear one.
  if ((humidityPct ?? 0) > 80) c.fog = Math.min((humidityPct - 80) / 20, 1) * 0.5;

  if (code >= 95) {
    c.thunder = code >= 96 ? 1 : 0.7;
    c.rain = 0.8;
    c.label = "thunderstorm";
  } else if (code >= 80) {
    c.rain = 0.9;
    c.label = "showers";
  } else if (code >= 71 && code <= 77) {
    c.rain = 0.5; // snow falls slower — carried as a thinner streak stream
    c.label = "snow";
  } else if (code >= 51) {
    c.rain = code >= 61 ? 0.7 : 0.35; // rain vs. drizzle
    c.label = code >= 61 ? "rain" : "drizzle";
  } else if (code === 45 || code === 48) {
    c.fog = 1;
    c.label = "fog";
  } else if (code >= 1) {
    c.label = c.clouds > 0.6 ? "overcast" : "partly cloudy";
  }
  return c;
}

export function createWeather(onChange) {
  let on = localStorage.getItem(WEATHER_KEY) === "on";
  let conditions = { ...CALM };
  let timer = 0;
  let lastError = "";

  /** Fetch the position — the BROWSER puts up the permission dialog, and we
   *  store the precise fix nowhere. A refusal is a normal outcome, not an
   *  error: the switch falls back to off and says why. */
  const position = () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("this browser has no geolocation"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(p.coords),
        (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? "location denied" : "location unavailable")),
        { maximumAge: REFRESH_MS, timeout: 10000, enableHighAccuracy: false },
      );
    });

  async function fetchWeather() {
    if (!on) return;
    try {
      const coords = await position();
      // Round BEFORE anything leaves this function — past this point the exact
      // position exists nowhere, not even in a variable further down.
      const lat = coords.latitude.toFixed(COORD_DECIMALS);
      const lon = coords.longitude.toFixed(COORD_DECIMALS);
      const url =
        `${ENDPOINT}?latitude=${lat}&longitude=${lon}` +
        `&current=weather_code,cloud_cover,relative_humidity_2m`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`weather service answered ${res.status}`);
      const data = await res.json();
      const cur = data.current ?? {};
      conditions = conditionsFrom(cur.weather_code ?? 0, cur.cloud_cover, cur.relative_humidity_2m);
      lastError = "";
    } catch (err) {
      // Weather is decoration. A failure must never disturb the map — it falls
      // back to calm and surfaces only in the tooltip.
      conditions = { ...CALM };
      lastError = err.message;
    }
    onChange?.();
  }

  function arm() {
    clearInterval(timer);
    if (!on) return;
    void fetchWeather();
    timer = setInterval(() => void fetchWeather(), REFRESH_MS);
  }

  function setOn(next) {
    on = !!next;
    localStorage.setItem(WEATHER_KEY, on ? "on" : "off");
    if (!on) {
      clearInterval(timer);
      conditions = { ...CALM };
      lastError = "";
      onChange?.();
      return;
    }
    arm();
  }

  arm();

  return {
    /** The four dials for the decor layer; all zero while switched off. */
    get: () => (on ? conditions : CALM),
    isOn: () => on,
    setOn,
    /** For the switch's tooltip: "rain" / "location denied" / "". */
    status: () => (!on ? "" : lastError || conditions.label),
  };
}
