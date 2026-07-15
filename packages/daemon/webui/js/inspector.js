/** Inspector panel: full memory body with clickable wikilinks, or the
 *  "unwritten note" view for ghosts. Markdown rendering is a deliberate
 *  mini-renderer (paragraphs, headings, lists, bold/italic/code, links,
 *  wikilinks) — enough for memory bodies, no vendored parser.
 *
 *  XSS policy: every string from the vault is HTML-escaped via esc() BEFORE
 *  the inline pass; inline() only introduces tags it constructs itself, with
 *  escaped attribute values and http(s)-restricted hrefs. Raw HTML in a
 *  memory body renders as text, never as markup. */

import { fetchNode } from "./graph-data.js";

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** inline markdown on an already-escaped string */
function inline(s, known) {
  return s
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id, label) => {
      const dead = known.has(id) ? "" : " dead";
      return `<button class="wikilink${dead}" data-link="${esc(id)}">${esc(label ?? id)}</button>`;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, `<a href="$2" target="_blank" rel="noopener">$1</a>`)
    .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, `$1<a href="$2" target="_blank" rel="noopener">$2</a>`);
}

function renderMarkdown(md, known) {
  const out = [];
  let list = null;
  const closeList = () => {
    if (list) {
      out.push(`<ul>${list.join("")}</ul>`);
      list = null;
    }
  };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      out.push(`<h3>${inline(esc(h[2]), known)}</h3>`);
    } else if (li) {
      (list ??= []).push(`<li>${inline(esc(li[1]), known)}</li>`);
    } else if (line.trim() === "") {
      closeList();
      out.push("");
    } else {
      closeList();
      out.push(`<p>${inline(esc(line), known)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

export function createInspector(el, contentEl, { knownIds, onNavigate, clusterColorOf, getCare, onAnnotate }) {
  let current = null; // node currently shown
  let careKind = null; // selected flag kind while composing

  const close = () => {
    el.hidden = true;
    current = null;
  };

  el.querySelector("#inspector-close").addEventListener("click", close);

  contentEl.addEventListener("click", async (ev) => {
    const link = ev.target.closest("button.wikilink");
    if (link) {
      onNavigate?.(link.dataset.link);
      return;
    }
    const kindBtn = ev.target.closest("button.care-kind");
    if (kindBtn && current) {
      careKind = kindBtn.dataset.kind;
      contentEl.querySelectorAll(".care-kind").forEach((b) => b.classList.toggle("active", b === kindBtn));
      contentEl.querySelector(".care-compose").hidden = false;
      contentEl.querySelector(".care-note").focus();
      return;
    }
    const submit = ev.target.closest("button.care-submit");
    if (submit && current && careKind) {
      const note = contentEl.querySelector(".care-note").value.trim();
      submit.disabled = true;
      submit.textContent = "flagging…";
      try {
        await onAnnotate?.(current.id, careKind, note);
        show(current); // re-render with the fresh flag list
      } catch {
        submit.disabled = false;
        submit.textContent = "failed — retry";
      }
    }
  });

  /** The vault-care block: existing open flags + compose row. Flags are
   *  worked off later in an AI session — the map never edits memories. */
  function careBlock(node) {
    const open = (getCare?.(node.id) ?? []).filter((a) => !a.done);
    const existing = open.length
      ? `<ul class="care-list">${open
          .map((a) => `<li><span class="care-badge">${esc(a.kind)}</span><span>${esc(a.note || "—")}</span><span class="care-date">${esc(a.date)}</span></li>`)
          .join("")}</ul>`
      : "";
    const kinds = node.kind === "ghost" ? ["write", "note"] : ["delete", "edit", "note"];
    return `
      <div class="insp-section-title">Vault care</div>
      ${existing}
      <div class="care-kinds">${kinds
        .map((k) => `<button class="care-kind" data-kind="${k}">${k}</button>`)
        .join("")}</div>
      <div class="care-compose" hidden>
        <textarea class="care-note" rows="2" maxlength="500" placeholder="what should happen with this note?"></textarea>
        <button class="care-submit">Flag for session</button>
      </div>`;
  }

  function kicker(node) {
    return `<div class="insp-kicker">
      <span class="dot" style="background:${clusterColorOf(node)}"></span>
      <span>${esc(node.cluster)}</span><span>·</span><span>${esc(node.kind === "ghost" ? "unwritten" : node.type)}</span>
    </div>`;
  }

  function chips(items, accentFirst = false) {
    if (!items.length) return "";
    return `<div class="chips">${items
      .map((t, i) => `<span class="chip${accentFirst && i === 0 ? " accent" : ""}">${esc(t)}</span>`)
      .join("")}</div>`;
  }

  function linkList(title, ids) {
    if (!ids?.length) return "";
    const lis = ids
      .map((id) => `<li><button class="wikilink${knownIds.has(id) ? "" : " dead"}" data-link="${esc(id)}">${esc(id)}</button></li>`)
      .join("");
    return `<div class="insp-section-title">${title}</div><ul class="link-list">${lis}</ul>`;
  }

  async function show(node) {
    el.hidden = false;
    current = node;
    careKind = null;

    if (node.kind === "ghost") {
      contentEl.innerHTML = `
        ${kicker(node)}
        <div class="insp-title">${esc(node.title)}</div>
        <div class="ghost-note">This note doesn't exist yet — it only lives as a link target.
        ${node.bridge ? "Several clusters point here: a connection worth writing down." : "Following the links below shows who expects it."}</div>
        ${node.bridge ? chips(node.bridge) : ""}
        ${linkList("Linked from", node.linked_by)}
        ${careBlock(node)}
      `;
      return;
    }

    contentEl.innerHTML = `${kicker(node)}<div class="insp-title">${esc(node.title)}</div><div class="insp-loading">loading…</div>`;
    const full = await fetchNode(node.id);
    if (el.hidden || current !== node) return; // closed or replaced while loading
    if (!full) {
      contentEl.innerHTML = `${kicker(node)}<div class="insp-title">${esc(node.title)}</div>
        <div class="ghost-note">Body could not be loaded.</div>`;
      return;
    }
    contentEl.innerHTML = `
      ${kicker(node)}
      <div class="insp-title">${esc(full.title)}</div>
      ${chips([full.scope, ...full.tags], true)}
      <div class="insp-meta">updated ${esc(full.updated)}${full.source ? ` · ${esc(full.source)}` : ""}</div>
      <div class="insp-body">${renderMarkdown(full.body, knownIds)}</div>
      ${node.bridge ? `<div class="insp-section-title">Bridges into</div>${chips(node.bridge)}` : ""}
      ${linkList("Connections", full.related)}
      ${careBlock(node)}
    `;
    contentEl.scrollTop = 0;
  }

  return { show, close, isOpen: () => !el.hidden };
}
