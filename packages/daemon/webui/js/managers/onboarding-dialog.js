/** Onboarding dialog — the browser surface of the onboarding interview:
 *  a fresh vault (few memories, no marker) auto-opens a short persona-aware
 *  wizard; every answer is saved as a user-directed profile memory via
 *  POST /ui/onboarding. "Later" snoozes for this browser session, "Don't
 *  ask again" sets the vault marker.
 *
 *  @param {object} deps
 *  @param {HTMLElement} deps.modal  the #onboarding-modal container */

import { fetchOnboarding, postOnboarding } from "../graph-data.js";

const $ = (sel) => document.querySelector(sel);
const SNOOZE_KEY = "bastra-onboarding-later";

export function createOnboardingDialog({ modal }) {
  const helpEl = $("#onboarding-help");
  const stepEl = $("#onboarding-step");
  const progEl = $("#onboarding-progress");
  const nextBtn = $("#onboarding-next");
  const backBtn = $("#onboarding-back");
  const laterBtn = $("#onboarding-later");
  const neverBtn = $("#onboarding-never");

  let catalog = null; // { personas: [{id,label}], questions: [...] }
  let persona = null;
  let steps = [];
  let idx = -1; // -1 = persona step
  let finished = false;
  let busy = false;
  const answers = {};

  const questionsFor = (p) => catalog.questions.filter((q) => !q.personas || q.personas.includes(p));

  function renderPersona() {
    idx = -1;
    stepEl.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.id = "onboarding-personas";
    for (const p of catalog.personas) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = p.label;
      b.addEventListener("click", () => {
        persona = p.id;
        steps = questionsFor(p.id);
        renderQuestion(0);
      });
      wrap.appendChild(b);
    }
    stepEl.appendChild(wrap);
    progEl.textContent = "what will your memory mainly hold?";
    nextBtn.hidden = true;
    backBtn.hidden = true;
  }

  function renderQuestion(i) {
    idx = i;
    const q = steps[i];
    stepEl.innerHTML = "";
    const ask = document.createElement("div");
    ask.className = "onboarding-ask";
    ask.textContent = q.ask;
    const ta = document.createElement("textarea");
    ta.id = "onboarding-answer";
    ta.rows = 3;
    ta.placeholder = q.hint;
    ta.value = answers[q.id] ?? "";
    stepEl.append(ask, ta);
    progEl.textContent = `${i + 1} / ${steps.length}${q.optional ? " · optional — empty skips it" : ""}`;
    backBtn.hidden = false;
    nextBtn.hidden = false;
    nextBtn.textContent = i === steps.length - 1 ? "Save profile" : "Next";
    ta.focus();
  }

  function collect() {
    const ta = stepEl.querySelector("textarea");
    if (ta && idx >= 0) answers[steps[idx].id] = ta.value;
  }

  function close() {
    modal.hidden = true;
  }

  nextBtn.addEventListener("click", async () => {
    if (busy) return;
    if (finished) {
      close();
      return;
    }
    collect();
    if (idx < steps.length - 1) {
      renderQuestion(idx + 1);
      return;
    }
    busy = true;
    nextBtn.disabled = true;
    nextBtn.textContent = "Saving…";
    try {
      const res = await postOnboarding({ persona, answers });
      finished = true;
      helpEl.textContent =
        `${res.saved} profile memories saved — your AI knows you from the next session on. ` +
        `Refine anytime by simply telling it. Got memories in other AI tools? The ↓ button imports them.`;
      stepEl.innerHTML = "";
      progEl.textContent = "";
      backBtn.hidden = true;
      laterBtn.hidden = true;
      neverBtn.hidden = true;
      nextBtn.textContent = "Done";
    } catch (err) {
      progEl.textContent = err.message;
      nextBtn.textContent = "Save profile";
    } finally {
      busy = false;
      nextBtn.disabled = false;
    }
  });

  backBtn.addEventListener("click", () => {
    if (busy) return;
    collect();
    if (idx <= 0) renderPersona();
    else renderQuestion(idx - 1);
  });

  laterBtn.addEventListener("click", () => {
    sessionStorage.setItem(SNOOZE_KEY, "1");
    close();
  });

  neverBtn.addEventListener("click", async () => {
    if (busy) return;
    try {
      await postOnboarding({ skip: true });
    } catch {
      // marker is best-effort — closing is what the user asked for
    }
    close();
  });

  // Auto-open on a fresh vault, unless snoozed for this browser session.
  (async () => {
    try {
      catalog = await fetchOnboarding();
    } catch {
      return; // ui disabled or daemon hiccup — never block the map
    }
    if (!catalog.needed || sessionStorage.getItem(SNOOZE_KEY) === "1") return;
    renderPersona();
    modal.hidden = false;
  })();
}
