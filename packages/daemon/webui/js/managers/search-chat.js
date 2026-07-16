/** Copilot chat beside the search results: deepen a search in conversation.
 *  Each message goes to the daemon's local agent (POST /ui/chat), which fans
 *  the question out into several recall queries and answers grounded in the
 *  hits — those finds are handed back to the search list, pinned on top.
 *
 *  @param {object} deps
 *  @param {HTMLElement} deps.panel  the #search-chat container
 *  @param {object} deps.sim        simulation (byId)
 *  @param {(nodes: object[]) => void} deps.onHits  copilot finds → search list */

import { postChat } from "../graph-data.js";

export function createSearchChat({ panel, sim, onHits }) {
  const log = panel.querySelector("#chat-log");
  const form = panel.querySelector("#chat-form");
  const input = panel.querySelector("#chat-input");
  const history = []; // {role, content} — the deepening context, capped
  let busy = false;

  function line(role, text) {
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.textContent = text;
    log.append(div);
    log.scrollTop = log.scrollHeight;
    return div;
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const message = input.value.trim();
    if (!message || busy) return;
    input.value = "";
    line("user", message);
    const thinking = line("sys", "digging through the vault…");
    busy = true;
    try {
      const res = await postChat(message, history);
      thinking.remove();
      line("ai", res.reply);
      history.push({ role: "user", content: message }, { role: "assistant", content: res.reply });
      if (history.length > 8) history.splice(0, history.length - 8);
      const found = res.hits.map((h) => sim.byId.get(h.id)).filter(Boolean);
      onHits(found);
      if (!found.length && res.hits.length) line("sys", "(the finds are not on the map)");
    } catch (err) {
      thinking.textContent = `copilot error — ${err.message}`;
      thinking.classList.add("err");
    } finally {
      busy = false;
      input.focus();
    }
  });

  return {
    setVisible(on) {
      panel.hidden = !on;
    },
  };
}
