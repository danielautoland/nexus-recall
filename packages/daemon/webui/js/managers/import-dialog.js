/** Import dialog (#208) — the visual sibling of `bastra import`: paste (or
 *  pick a file with) a memory list from another AI tool; candidates are
 *  staged in import-review.md via POST /ui/import for the next session to
 *  distill with the user. Staging only — the dialog never saves memories.
 *
 *  @param {object} deps
 *  @param {HTMLElement} deps.modal    the #import-modal container
 *  @param {HTMLElement} deps.opener   the topbar button that opens it */

import { postImport } from "../graph-data.js";

const $ = (sel) => document.querySelector(sel);

// per-source guidance: where THIS tool keeps its memory list
const SOURCE_HINTS = {
  chatgpt:
    "ChatGPT: Settings → Personalization → Manage memories — copy the list and paste it here. " +
    "Full chat history (conversations.json)? Run `bastra import <file>` in a terminal instead.",
  claude:
    "Claude: Settings → Memory — copy your memory text and paste it here. " +
    "Full chat history (conversations.json)? Run `bastra import <file>` in a terminal instead.",
  gemini: "Gemini: Settings → Saved Info — copy the entries and paste them here.",
  text: "Any plain list works — one fact per line, bullets and numbering are fine.",
};

export function createImportDialog({ modal, opener }) {
  const textEl = $("#import-text");
  const statusEl = $("#import-status");
  const stageBtn = $("#import-stage");
  const fileInput = $("#import-file");
  const sourceHintEl = $("#import-source-hint");
  let source = "chatgpt";
  let busy = false;
  sourceHintEl.textContent = SOURCE_HINTS[source];

  function setStatus(text, cls = "") {
    statusEl.textContent = text;
    statusEl.className = cls;
  }

  function open() {
    modal.hidden = false;
    setStatus("");
    document.addEventListener("keydown", onKey);
    textEl.focus();
  }

  function close() {
    modal.hidden = true;
    document.removeEventListener("keydown", onKey);
  }

  function onKey(ev) {
    if (ev.key === "Escape") close();
  }

  opener.addEventListener("click", open);
  $("#import-cancel").addEventListener("click", close);
  modal.addEventListener("pointerdown", (ev) => {
    if (ev.target === modal) close(); // click outside the box = close
  });

  $("#import-source").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-source]");
    if (!b) return;
    source = b.dataset.source;
    sourceHintEl.textContent = SOURCE_HINTS[source];
    $("#import-source")
      .querySelectorAll("button")
      .forEach((x) => x.classList.toggle("active", x === b));
  });

  $("#import-choose").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    textEl.value = await file.text();
    // filename hints the source, same heuristics as the CLI
    const name = file.name.toLowerCase();
    const hinted = /chatgpt|openai/.test(name)
      ? "chatgpt"
      : /claude|anthropic/.test(name)
        ? "claude"
        : /gemini|takeout/.test(name)
          ? "gemini"
          : null;
    if (hinted) $(`#import-source button[data-source="${hinted}"]`)?.click();
    setStatus(`loaded ${file.name}`);
  });

  stageBtn.addEventListener("click", async () => {
    const text = textEl.value.trim();
    if (!text || busy) return;
    busy = true;
    stageBtn.disabled = true;
    setStatus("staging…");
    try {
      const r = await postImport(text, source);
      setStatus(
        `✓ ${r.staged} staged` +
          (r.skipped_duplicates > 0 ? ` · ${r.skipped_duplicates} duplicate(s) skipped` : "") +
          ` · ${r.open_total} open — your next AI session distills them with you`,
        "ok",
      );
      textEl.value = "";
    } catch (err) {
      setStatus(err.message, "err");
    } finally {
      busy = false;
      stageBtn.disabled = false;
    }
  });

  return { open };
}
