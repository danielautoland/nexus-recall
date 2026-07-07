/**
 * `bastra models` — inspect / set the local generation (doc2query + rerank) text
 * model. Mirrors `bastra embeddings`: the choice persists to cli-settings.json
 * (cross-platform, so Windows/Linux carry it too) and the Ollama pull is
 * delegated to enableGenerationModel.
 *
 *   bastra models            show the active model + this machine's recommendation
 *   bastra models recommend  print the hardware-tiered recommendation only
 *   bastra models set <tag>  pull <tag> + persist it as the generation model
 */
import { detectHardware, recommendTextModel } from "./hardware.js";
import { resolveGenerationModel, GENERATION_MODEL_DEFAULT } from "../settings.js";
import { enableGenerationModel } from "./ollama.js";

function write(line: string): void {
  process.stdout.write(line + "\n");
}

export async function cmdModels(opts: {
  sub: string | null;
  positional?: string[];
  settingsPath?: string;
}): Promise<number> {
  switch (opts.sub ?? "status") {
    case "status":
      return cmdStatus(opts.settingsPath);
    case "recommend":
      return cmdRecommend();
    case "set": {
      // positional = [command, surface, ...args] — the model tag is [2],
      // matching cmdBridges / cmdCommons.
      const model = opts.positional?.[2];
      if (!model) {
        process.stderr.write("usage: bastra models set <ollama-model-tag>   (e.g. gemma4:12b)\n");
        return 2;
      }
      return cmdSet(model, opts.settingsPath);
    }
    default:
      process.stderr.write("usage: bastra models [status | recommend | set <tag>]\n");
      return 2;
  }
}

async function cmdStatus(settingsPath?: string): Promise<number> {
  const active = await resolveGenerationModel(settingsPath);
  const hw = detectHardware();
  const rec = recommendTextModel(hw.ramGB);
  write(`generation model: ${active}${active === GENERATION_MODEL_DEFAULT ? " (default)" : ""}`);
  write(`machine: ${hw.ramGB} GB${hw.chip ? `, ${hw.chip}` : ""} (${hw.platform})`);
  write(`recommended: ${rec.model ?? "— none —"}  [${rec.tier}]`);
  if (rec.alt) write(`  opt-in alternative: ${rec.alt.model} — ${rec.alt.note}`);
  write(rec.note);
  if (rec.model && active !== rec.model && rec.tier !== "keyword-only") {
    write(`\nto switch: bastra models set ${rec.alt?.model ?? rec.model}`);
  }
  return 0;
}

async function cmdRecommend(): Promise<number> {
  const hw = detectHardware();
  const rec = recommendTextModel(hw.ramGB);
  write(rec.model ?? "none");
  write(`# ${hw.ramGB} GB [${rec.tier}] — ${rec.note}`);
  if (rec.alt) write(`# opt-in: ${rec.alt.model}`);
  return 0;
}

async function cmdSet(model: string, settingsPath?: string): Promise<number> {
  write(`Setting the generation model to ${model} …`);
  const r = await enableGenerationModel(model, { dryRun: false }, settingsPath);
  write((r.activated ? "✓ " : "✗ ") + r.message);
  return r.activated ? 0 : 1;
}
