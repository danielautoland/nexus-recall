/**
 * hardware.ts — hardware detection + local-model recommendation for the installer.
 *
 * The installer already sets up the embedding model (embeddinggemma, ~0.6 GB) on
 * every machine that can run Ollama. The generation model (doc2query + rerank) is
 * heavier and its viable size depends on the machine's RAM, so we recommend a tier
 * instead of hardcoding one default.
 *
 * Baseline is 16 GB (the M4 Mac mini / a modern Windows dev box). We deliberately
 * do NOT optimize for 8 GB machines: below the baseline we recommend keyword/embed
 * only and skip the generation model rather than thrash a too-small machine.
 *
 * RAM is the single load-bearing signal, so detection stays cross-platform on
 * `os.totalmem()`; the Mac chip string is informational only.
 */
import { totalmem } from "node:os";
import { execFileSync } from "node:child_process";

export interface HardwareInfo {
  platform: NodeJS.Platform;
  ramGB: number;
  /** Apple Silicon chip string on macOS (e.g. "Apple M4 Pro"), else null. Info only. */
  chip: string | null;
}

export interface TextModelRec {
  /** Ollama model tag to pull, or null when the machine is below the baseline. */
  model: string | null;
  /** Approximate on-disk / RAM footprint of `model`, GB. 0 when model is null. */
  sizeGB: number;
  /** Coarse tier label for the UI. */
  tier: "keyword-only" | "baseline" | "enhanced" | "high";
  /** One-line, user-facing rationale. */
  note: string;
  /** A heavier opt-in alternative the machine can also run, if any. */
  alt?: { model: string; sizeGB: number; note: string };
}

/** Detect the running machine. Pure read; never throws (chip probe is best-effort). */
export function detectHardware(): HardwareInfo {
  const ramGB = Math.round(totalmem() / 1024 ** 3);
  let chip: string | null = null;
  if (process.platform === "darwin") {
    try {
      chip = execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], {
        encoding: "utf8",
        timeout: 2000,
      }).trim() || null;
    } catch {
      /* best-effort; RAM is what drives the recommendation */
    }
  }
  return { platform: process.platform, ramGB, chip };
}

// The generation-model ladder. Kept as data so `bastra models` and the wizard
// share one source of truth, and so the tiers are unit-testable.
const BASELINE_GB = 16;
const ENHANCED_GB = 24;
const HIGH_GB = 32;

/**
 * Recommend a generation (doc2query + rerank) model for `ramGB`.
 *
 * Below the 16 GB baseline: no generation model — embedding + BM25 recall still
 * work and don't need it. At/above baseline: a 4B text model. On roomy machines
 * a 12B is offered as the quality alternative.
 */
export function recommendTextModel(ramGB: number): TextModelRec {
  if (ramGB < BASELINE_GB) {
    return {
      model: null,
      sizeGB: 0,
      tier: "keyword-only",
      note: `${ramGB} GB is below the 16 GB baseline — keyword + semantic recall run fine without a generation model.`,
    };
  }
  if (ramGB < ENHANCED_GB) {
    return {
      model: "gemma3:4b",
      sizeGB: 3.3,
      tier: "baseline",
      note: `${ramGB} GB — gemma3:4b (a 4B text model) fits comfortably alongside the embedding model.`,
    };
  }
  if (ramGB < HIGH_GB) {
    return {
      model: "gemma3:4b",
      sizeGB: 3.3,
      tier: "enhanced",
      note: `${ramGB} GB — gemma3:4b is the safe default; gemma4:12b gives noticeably better rewrites and still fits.`,
      alt: { model: "gemma4:12b", sizeGB: 8.1, note: "12B, best-quality rewrites (fits 24 GB+)" },
    };
  }
  return {
    model: "gemma4:12b",
    sizeGB: 8.1,
    tier: "high",
    note: `${ramGB} GB — gemma4:12b (a 12B frontier text model) for the best-quality rewrites.`,
  };
}
