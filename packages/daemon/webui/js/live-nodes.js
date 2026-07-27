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
 */
export function createLiveNodes({ sim, inspector, select }) {
  /** Adopt a newborn as a REAL sim node the moment its supernova appears —
   *  clickable, hoverable, glowing with its valence, and it stays put after
   *  the burst fades (no reload needed). */
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
