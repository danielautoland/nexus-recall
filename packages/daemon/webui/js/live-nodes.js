/** Live lane (#216/#217): memories born AFTER the page loaded.
 *
 *  Split out of app.js (#284) unchanged. Two jobs that belong together:
 *  adopting a newborn as a real sim node, and opening a memory by id whether
 *  or not it was in the graph at load time.
 */
import { fetchNode, nodeRadius } from "./graph-data.js";

/**
 * @param {object} deps
 * @param {object} deps.sim
 * @param {object} deps.inspector
 * @param {(node: object, fly?: boolean) => void} deps.select
 * @param {() => string} [deps.getStructureMode] active structure mode ("clusters" | "blocks")
 * @param {(node: object) => void} [deps.onAdopt] the newborn's grouping reached the map (#307)
 */
export function createLiveNodes({ sim, inspector, select, getStructureMode = () => "clusters", onAdopt = null }) {
  /** Adopt a newborn as a REAL sim node the moment its supernova appears —
   *  clickable, hoverable, glowing with its valence, and it stays put after
   *  the burst fades (no reload needed). */
  function adoptLiveNode(u) {
    if (sim.byId.has(u.id)) return;
    // #307: file the newborn exactly where a reloaded graph would put it.
    // The live entry now carries the whole grouping coordinate (cluster +
    // group + sub, see live-updates.ts); it used to carry the cluster alone,
    // so every adopted memory was hardcoded into the "other" building block
    // and the "general" sub-area — visible in blocks structure, in the ring's
    // meta band and in the galaxy's sub-rings. The fallbacks stay for entries
    // from an older daemon.
    const group = u.group ?? "other";
    const baseCluster = u.cluster;
    // The DISPLAYED cluster follows the active structure mode, same as
    // applyStructure() does for every other node — otherwise a memory adopted
    // while the ring/semantic view is open (both open in "blocks") would be
    // the one node keyed by its fine cluster among group keys.
    const cluster = getStructureMode() === "blocks" ? group : baseCluster;
    const anchor = sim.centers.get(cluster);
    const node = {
      id: u.id,
      title: u.title,
      type: u.type,
      scope: u.scope ?? baseCluster,
      cluster,
      baseCluster,
      group,
      sub: u.sub ?? "general",
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
    // #307: the grouping layers (cluster/group lists, colors, cloud anchors,
    // galaxies) are derived ONCE from the loaded graph. A newborn may belong
    // to a category that did not exist then — on a fresh vault the onboarding
    // memories are what creates the user area in the first place — so hand
    // the node over and let the owner of those layers extend them.
    onAdopt?.(node);
    sim.reheat?.();
  }

  /** Open a memory by id, even if it was born after the page load.
   *
   *  `hint` is the live-update entry that triggered the click. It carries the
   *  `cluster` field the node endpoint does NOT return and that adoptLiveNode
   *  needs for the galaxy anchor — without it the node landed in the middle
   *  instead of in its galaxy. With it, a memory not yet in the graph is
   *  adopted first and then flown to normally; before, this branch only opened
   *  the inspector and the camera stayed put. */
  async function openMemoryById(id, hint) {
    let n = sim.byId.get(id);
    if (!n && hint?.cluster) {
      adoptLiveNode({ ...hint, id });
      n = sim.byId.get(id);
    }
    if (n) {
      select(n);
      return;
    }
    try {
      const full = await fetchNode(id);
      document.body.classList.add("inspector-open");
      inspector.show({ kind: "memory", ...full });
    } catch {
      // not indexed yet — the next click after a reload will hit it
    }
  }

  return { adoptLiveNode, openMemoryById };
}
