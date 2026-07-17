/**
 * Onboarding interview — seed a FRESH vault by asking a handful of
 * persona-aware questions instead of starting cold. The first answer (what
 * the memory is mainly for: developer / business / personal / mixed) steers
 * which follow-ups appear, so the interview digs deep without demanding
 * much: 7 questions total, 3 of them optional.
 *
 * Three surfaces, one catalog: the map's onboarding dialog (POST
 * /ui/onboarding), `bastra onboard` in a terminal, and the AI session
 * itself (the session hook injects the catalog as an interview guide; the
 * session model asks adaptively). Answers become REAL memories immediately
 * — the user wrote them, so `write_origin: "user-directed"` and no review
 * gate. A marker file at the vault root stops the nudge after the
 * interview is done or explicitly skipped.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { saveMemory, type SaveMemoryInput } from "@bastra-recall/core";
import { sendJsonPlain } from "./webui.js";
import { getUiEnabled } from "./settings.js";

export const ONBOARD_MARKER = ".onboarding-done";
/** Below this vault size a vault counts as fresh (an interview writes ~8). */
export const FRESH_VAULT_MAX = 8;

export const PERSONAS = ["developer", "business", "personal", "mixed"] as const;
export type Persona = (typeof PERSONAS)[number];

export const PERSONA_LABELS: Record<Persona, string> = {
  developer: "Code & projects — I build software",
  business: "Company & decisions — I run a team or business",
  personal: "Life & knowledge — a good memory for everything",
  mixed: "A bit of everything",
};

export interface OnboardingQuestion {
  id: string;
  ask: string;
  hint: string;
  optional: boolean;
  /** null = every persona; mixed gets the first question of each persona. */
  personas: Persona[] | null;
}

export const QUESTIONS: OnboardingQuestion[] = [
  {
    id: "identity",
    ask: "How should your AI address you — and in what language and tone?",
    hint: "e.g. Daniel · German, informal · terse and technical",
    optional: false,
    personas: null,
  },
  {
    id: "rules",
    ask: "Hard rules — anything your AI should ALWAYS or NEVER do?",
    hint: "e.g. never push to git on its own · always ask before deleting",
    optional: true,
    personas: null,
  },
  {
    id: "stack",
    ask: "Your stack — the languages, frameworks and tools you live in?",
    hint: "e.g. TypeScript + Node, SwiftUI, Postgres, no ORMs",
    optional: false,
    personas: ["developer", "mixed"],
  },
  {
    id: "projects",
    ask: "What are you building right now — your active projects, one line each?",
    hint: "project name — what it is, where it stands",
    optional: false,
    personas: ["developer"],
  },
  {
    id: "workflow",
    ask: "How do you like to work — tests, commits, reviews, code style?",
    hint: "e.g. I commit myself · tests before merge · small PRs",
    optional: true,
    personas: ["developer"],
  },
  {
    id: "role",
    ask: "Your company and role — what do you run, and what does it do?",
    hint: "e.g. CEO of a 12-person agency for industrial clients",
    optional: false,
    personas: ["business", "mixed"],
  },
  {
    id: "people",
    ask: "The key people around you — names and roles you work with closely?",
    hint: "e.g. Anna — co-founder · Marc — lead dev · Kim — biggest client",
    optional: false,
    personas: ["business"],
  },
  {
    id: "duties",
    ask: "What should your AI prepare or watch for you — meetings, mail, decisions?",
    hint: "e.g. brief me before calls · draft replies · flag deadlines",
    optional: true,
    personas: ["business"],
  },
  {
    id: "world",
    ask: "Your day-to-day world — the people, places and routines that matter?",
    hint: "e.g. two kids · Berlin · gym Tue+Thu · weekly call with mom",
    optional: false,
    personas: ["personal", "mixed"],
  },
  {
    id: "remember",
    ask: "What must never be forgotten — dates, preferences, running threads?",
    hint: "e.g. anniversary May 12 · no seafood · house hunt ongoing",
    optional: false,
    personas: ["personal"],
  },
  {
    id: "goals",
    ask: "What are you working toward right now — projects, plans, goals?",
    hint: "e.g. finish the certification · renovate the kitchen",
    optional: true,
    personas: ["personal"],
  },
  {
    id: "freeform",
    ask: "Anything else your AI should know about you? Write freely.",
    hint: "whatever helps — background, quirks, pet peeves",
    optional: true,
    personas: null,
  },
];

export function questionsFor(persona: Persona): OnboardingQuestion[] {
  return QUESTIONS.filter((q) => q.personas === null || q.personas.includes(persona));
}

interface Template {
  id: string;
  title: string;
  type: SaveMemoryInput["type"];
  tags: string[];
  recall_when: string[];
  note?: string;
}

const TEMPLATES: Record<string, Template> = {
  identity: {
    id: "profile-how-to-address-me",
    title: "Profile: how to address me",
    type: "user-preference",
    tags: ["profile", "onboarding", "tone"],
    recall_when: ["session start — language and tone", "how should I address the user", "what language does the user prefer"],
  },
  rules: {
    id: "profile-standing-rules",
    title: "Profile: standing rules (always/never)",
    type: "workflow",
    tags: ["profile", "onboarding", "rules"],
    recall_when: ["before running a risky or irreversible action", "what are the user's hard rules", "am I allowed to do this on my own"],
  },
  stack: {
    id: "profile-stack",
    title: "Profile: stack and tools",
    type: "user-preference",
    tags: ["profile", "onboarding", "stack"],
    recall_when: ["about to write code — which stack", "what languages and frameworks does the user use", "choosing a library or tool"],
  },
  projects: {
    id: "profile-active-projects",
    title: "Profile: active projects",
    type: "project-fact",
    tags: ["profile", "onboarding", "projects"],
    recall_when: ["what is the user building right now", "session start project context", "which project does this task belong to"],
  },
  workflow: {
    id: "profile-dev-workflow",
    title: "Profile: how I like to work",
    type: "workflow",
    tags: ["profile", "onboarding", "workflow"],
    recall_when: ["before committing or opening a PR", "how does the user want tests and reviews handled", "what workflow does the user prefer"],
  },
  role: {
    id: "profile-company-and-role",
    title: "Profile: company and role",
    type: "project-fact",
    tags: ["profile", "onboarding", "business"],
    recall_when: ["what company does the user run", "business context for a decision or draft", "who is the user professionally"],
  },
  people: {
    id: "profile-key-people",
    title: "Profile: key people",
    type: "project-fact",
    tags: ["profile", "onboarding", "people"],
    recall_when: ["who does the user work with", "drafting a message to a colleague", "who is this person the user mentioned"],
    note: "Split into one memory per person (memories/people) when a person starts accumulating their own history.",
  },
  duties: {
    id: "profile-assistant-duties",
    title: "Profile: what to prepare and watch",
    type: "workflow",
    tags: ["profile", "onboarding", "duties"],
    recall_when: ["what should I proactively prepare for the user", "meeting or mail preparation", "daily assistant duties"],
  },
  world: {
    id: "profile-my-world",
    title: "Profile: my day-to-day world",
    type: "user-preference",
    tags: ["profile", "onboarding", "personal"],
    recall_when: ["personal context — people, places, routines", "planning something in the user's daily life", "who or what matters to the user"],
  },
  remember: {
    id: "profile-never-forget",
    title: "Profile: never forget",
    type: "user-preference",
    tags: ["profile", "onboarding", "personal"],
    recall_when: ["important dates or standing preferences", "what must never be forgotten", "before making plans for the user"],
  },
  goals: {
    id: "profile-personal-goals",
    title: "Profile: current goals",
    type: "project-fact",
    tags: ["profile", "onboarding", "goals"],
    recall_when: ["what is the user working toward", "goal context for advice or planning"],
  },
  freeform: {
    id: "profile-about-me",
    title: "Profile: about me (self-described)",
    type: "user-preference",
    tags: ["profile", "onboarding"],
    recall_when: ["session start — who is the user", "general context about the user", "what did the user say about themselves"],
  },
};

function clip(text: string, max: number): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Persona choice + answers → ready-to-save memories. Always includes the
 * usage-profile memory (what this vault is for — the signal future surfaces
 * like the Bastra app can tailor to); one memory per non-empty answer.
 */
export function buildOnboardingMemories(persona: Persona, answers: Record<string, string>): SaveMemoryInput[] {
  const out: SaveMemoryInput[] = [
    {
      id: "profile-recall-usage",
      title: "Profile: what this vault is for",
      type: "user-preference",
      scope: "user-preference",
      summary: `The user's memory profile: ${PERSONA_LABELS[persona]}.`,
      body: `**${PERSONA_LABELS[persona]}** (persona: ${persona})\n\nChosen during onboarding — the primary lens for what this vault should hold and how features should be tailored.`,
      topic_path: ["profile", "usage"],
      tags: ["profile", "onboarding", "persona"],
      recall_when: ["what does the user use this memory for", "tailoring features to the user's persona", "session start context"],
      write_origin: "user-directed",
      overwrite: true,
    },
  ];
  for (const q of questionsFor(persona)) {
    const answer = (answers[q.id] ?? "").trim();
    if (!answer) continue;
    const t = TEMPLATES[q.id];
    out.push({
      id: t.id,
      title: t.title,
      type: t.type,
      scope: "user-preference",
      summary: clip(answer, 240),
      body: answer + (t.note ? `\n\n*${t.note}*` : ""),
      topic_path: ["profile", q.id],
      tags: t.tags,
      recall_when: t.recall_when,
      write_origin: "user-directed",
      overwrite: true,
    });
  }
  return out;
}

export async function isOnboardingDone(vaultPath: string): Promise<boolean> {
  try {
    await readFile(join(vaultPath, ONBOARD_MARKER), "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function markOnboardingDone(vaultPath: string, via: string): Promise<void> {
  await writeFile(
    join(vaultPath, ONBOARD_MARKER),
    `onboarded ${new Date().toISOString().slice(0, 10)} via ${via}\n`,
    "utf8",
  );
}

export async function isOnboardingNeeded(vaultPath: string, vaultSize: number): Promise<boolean> {
  if (vaultSize >= FRESH_VAULT_MAX) return false;
  return !(await isOnboardingDone(vaultPath));
}

/** GET /hook/onboarding — loopback-only, NOT ui-gated (the session hook
 *  needs it regardless of whether the map is enabled). */
export async function handleHookOnboarding(
  res: ServerResponse,
  vaultPath: string,
  vaultSize: number,
): Promise<void> {
  sendJsonPlain(res, 200, { needed: await isOnboardingNeeded(vaultPath, vaultSize) });
}

/**
 * GET/POST /ui/onboarding — the map's onboarding dialog. GET returns the
 * catalog + whether the dialog should auto-open; POST saves the answers as
 * user-directed memories (or just sets the marker on {skip:true}).
 */
export async function handleUiOnboarding(
  req: IncomingMessage,
  res: ServerResponse,
  vaultPath: string,
  vaultSize: number,
  settingsPath?: string,
): Promise<void> {
  if (!(await getUiEnabled(settingsPath))) {
    sendJsonPlain(res, 404, { error: "ui disabled" });
    return;
  }
  if (req.method === "GET") {
    sendJsonPlain(res, 200, {
      needed: await isOnboardingNeeded(vaultPath, vaultSize),
      personas: PERSONAS.map((p) => ({ id: p, label: PERSONA_LABELS[p] })),
      questions: QUESTIONS,
    });
    return;
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 256 * 1024) {
      sendJsonPlain(res, 413, { error: "body too large" });
      return;
    }
  }
  let body: { persona?: unknown; answers?: unknown; skip?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    sendJsonPlain(res, 400, { error: "invalid JSON body" });
    return;
  }
  if (body.skip === true) {
    await markOnboardingDone(vaultPath, "map (skipped)");
    sendJsonPlain(res, 200, { saved: 0, skipped: true });
    return;
  }
  const persona = typeof body.persona === "string" && (PERSONAS as readonly string[]).includes(body.persona)
    ? (body.persona as Persona)
    : null;
  if (!persona) {
    sendJsonPlain(res, 400, { error: `persona required — one of: ${PERSONAS.join(", ")}` });
    return;
  }
  const answers: Record<string, string> = {};
  if (typeof body.answers === "object" && body.answers !== null) {
    for (const [k, v] of Object.entries(body.answers as Record<string, unknown>)) {
      if (typeof v === "string") answers[k] = v;
    }
  }
  const memories = buildOnboardingMemories(persona, answers);
  for (const m of memories) {
    await saveMemory(vaultPath, m);
  }
  await markOnboardingDone(vaultPath, "map");
  sendJsonPlain(res, 200, { saved: memories.length, skipped: false });
}
