/** Drill switcher (sidebar): appears for instance-mode areas like PROJECTS.
 *
 *  Split out of app.js (#284) unchanged. Revealed AFTER the wheel's fan-out
 *  settles, with a short attention pulse that pulls the eye over — "there's
 *  more to switch here".
 */

const $ = (sel) => document.querySelector(sel);

/**
 * @param {object} deps
 * @param {object} deps.ringView  owns the actual instance switch
 */
export function createDrillSwitcher({ ringView }) {
  let lastDrillState = null;
  let drillRevealTimer = 0;

  function render(state) {
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

  return { render };
}
