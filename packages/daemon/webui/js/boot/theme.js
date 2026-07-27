/** Theme: the light/dark choice and the node palette that follows it.
 *
 *  Split out of app.js (#284) unchanged. Two halves that have to stay
 *  together: the stored preference is applied before first paint, and the
 *  toggle re-reads the `--map-*` custom properties afterwards so the canvas
 *  recolors with the chrome (the canvas cannot inherit CSS).
 *
 *  `sat`/`light` are read back from the stylesheet rather than hard-coded,
 *  which is why they live here and are handed out through `satLight()` — four
 *  managers ask for them and they change on every toggle.
 */
import { clusterColor } from "../graph-data.js";

const THEME_KEY = "bastra-vault-map-theme";

/** Apply the stored (or system) theme to <html> before the app boots, so the
 *  first paint is already the right one — no flash. */
export function applyStoredTheme(root) {
  const stored = localStorage.getItem(THEME_KEY);
  root.dataset.theme = stored ?? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}

/**
 * @param {object} deps
 * @param {HTMLElement} deps.root      the <html> element
 * @param {HTMLElement} deps.toggle    the toggle button
 * @param {object} deps.renderer
 * @param {() => object} deps.getHues  live hue map — changes with the structure mode
 * @param {() => void} deps.onChange   called after a toggle (legend dots follow the ink)
 */
export function createTheme({ root, toggle, renderer, getHues, onChange }) {
  const readSatLight = () => {
    const s = getComputedStyle(root);
    return [s.getPropertyValue("--map-node-sat").trim(), s.getPropertyValue("--map-node-light").trim()];
  };
  let [sat, light] = readSatLight();

  const colorOf = (n) =>
    n.kind === "ghost"
      ? getComputedStyle(root).getPropertyValue("--map-ghost").trim()
      : clusterColor(getHues(), n.cluster, sat, light);

  toggle.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, root.dataset.theme);
    renderer.refreshTheme();
    [sat, light] = readSatLight();
    onChange();
  });

  return {
    colorOf,
    /** Live pair — callers hold this function, never the values. */
    satLight: () => [sat, light],
  };
}
