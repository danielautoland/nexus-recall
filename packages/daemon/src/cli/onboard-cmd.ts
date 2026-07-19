/**
 * `bastra onboard` — the terminal surface of the onboarding interview:
 * persona choice, then the persona's questions one by one (optionals are
 * skippable with Enter), answers saved immediately as user-directed
 * memories. `onboard skip` just sets the marker (stop nudging); `onboard
 * done` is what an AI session runs after finishing the interview itself.
 */
import { createInterface } from "node:readline/promises";
import { saveMemory } from "@bastra-recall/core";
import {
  PERSONAS,
  PERSONA_LABELS,
  questionsFor,
  buildOnboardingMemories,
  persistConventionSettings,
  persistLanguageSetting,
  markOnboardingDone,
  isOnboardingDone,
  type Persona,
} from "../onboarding.js";
import { resolveVault } from "./helpers.js";
import type { ParsedArgs } from "./types.js";

export async function cmdOnboard(args: ParsedArgs): Promise<number> {
  const vault = await resolveVault({ dryRun: false, vaultPath: args.vaultPath });
  if ("error" in vault) {
    process.stderr.write(`${vault.error}\n`);
    return 1;
  }

  if (args.surface === "skip" || args.surface === "done") {
    await markOnboardingDone(vault.path, args.surface === "skip" ? "cli (skipped)" : "session");
    process.stdout.write(
      args.surface === "skip"
        ? "✓ onboarding dismissed — run `bastra onboard` anytime to do the interview later\n"
        : "✓ onboarding marked done\n",
    );
    return 0;
  }

  if (!process.stdin.isTTY) {
    process.stderr.write(
      "usage: bastra onboard          run the interview (interactive)\n" +
        "       bastra onboard skip    stop the onboarding nudge without answering\n",
    );
    return 2;
  }

  if (await isOnboardingDone(vault.path)) {
    process.stdout.write("(you have onboarded before — answers overwrite your existing profile memories)\n\n");
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(
      "Seed your vault in ~5 minutes — a handful of questions, every answer becomes a memory\n" +
        "your AI recalls from day one. Enter skips an optional question; Ctrl-C aborts.\n\n" +
        "What will your memory mainly hold?\n",
    );
    PERSONAS.forEach((p, i) => process.stdout.write(`  ${i + 1}. ${PERSONA_LABELS[p]}\n`));
    let persona: Persona | null = null;
    while (persona === null) {
      const pick = (await rl.question("> ")).trim();
      const idx = parseInt(pick, 10) - 1;
      if (idx >= 0 && idx < PERSONAS.length) persona = PERSONAS[idx];
      else process.stdout.write(`pick 1-${PERSONAS.length}\n`);
    }

    const answers: Record<string, string> = {};
    for (const q of questionsFor(persona)) {
      process.stdout.write(`\n${q.ask}${q.optional ? "  (optional)" : ""}\n  ${q.hint}\n`);
      const answer = (await rl.question("> ")).trim();
      if (answer) answers[q.id] = answer;
    }

    const memories = buildOnboardingMemories(persona, answers);
    for (const m of memories) {
      await saveMemory(vault.path, m);
    }
    await persistConventionSettings(answers);
    await persistLanguageSetting(answers);
    await markOnboardingDone(vault.path, "cli");
    process.stdout.write(
      `\n✓ ${memories.length} profile memories saved — your AI knows you from the next session on.\n` +
        `  Refine anytime: just tell your AI, or re-run \`bastra onboard\` (answers overwrite).\n` +
        `  Got memories in other AI tools? \`bastra import\` brings them along too.\n`,
    );
    return 0;
  } finally {
    rl.close();
  }
}
