/**
 * `bastra bridges` — the shared learned-recall layer (#120).
 *
 * Bridges live IN the Bastra Commons repo (alongside recipes/ and verifications/),
 * under bridges/<lang>/*.json. So they share the Commons clone, sync, and PR-gated
 * contribution model — `bastra commons enable` clones the repo; `bastra bridges enable`
 * just flips the separate sharedRecall toggle so the daemon loads the bridge pool
 * from that clone and uses it to widen recall queries. The daemon NEVER writes the
 * synced repo; sharing goes through PRs.
 *
 * A bridge is a language-tagged vocabulary-expansion rule {lang, trigger_terms,
 * expansion_terms} — no memory id or vault content (see learned-recall/bridges.ts).
 *
 * Local-first: toggle off ⇒ the daemon never builds the pool; nothing leaves the
 * machine. Contribution is opt-in and PR-only — there is no auto-egress.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Vault } from "@bastra-recall/core";
import {
  getSharedRecallEnabled,
  setSharedRecallEnabled,
  getSharedRecallLanguage,
  setSharedRecallLanguage,
  clearSharedRecallLanguage,
} from "../settings.js";
import { envFirst } from "../env.js";
import { commonsPath, COMMONS_REPO_URL } from "./commons.js";
import { BridgePool, distinctiveTerms } from "../learned-recall/bridges.js";
import { readEventLog, reconstructReaches, harvestBridges, writeBridges, extractCandidatePools, harvestFarBridges } from "../learned-recall/harvest.js";
import { ollamaChat, DEFAULT_RERANK_MODEL, listOllamaModels, resolveRerankModel } from "../learned-recall/reranker.js";
import { isSupportedLanguage, SUPPORTED_LANGUAGES } from "../learned-recall/language.js";

/** Bridges share the Commons clone. Env override kept for tests/relocation. */
export function bridgesPath(): string {
  return process.env.BASTRA_BRIDGES_PATH ?? commonsPath();
}

export async function cmdBridges(opts: { sub: string | null; positional?: string[] }): Promise<number> {
  const sub = opts.sub ?? "status";
  switch (sub) {
    case "enable": {
      await setSharedRecallEnabled(true);
      const cloned = existsSync(join(commonsPath(), ".git"));
      const hasPool = existsSync(join(bridgesPath(), "bridges"));
      process.stdout.write("✓ shared learned-recall enabled — restart the daemon to load it\n");
      if (!cloned) {
        process.stdout.write("  note: bridges live in the Commons repo — run 'bastra commons enable' to clone it first\n");
      } else if (!hasPool) {
        process.stdout.write("  note: the Commons repo has no bridges/ yet; the pool is empty (recall unchanged) until bridges are added\n");
      }
      return 0;
    }
    case "disable": {
      await setSharedRecallEnabled(false);
      process.stdout.write("✓ shared learned-recall disabled — restart the daemon to apply\n");
      return 0;
    }
    case "update": {
      // Bridges sync with the Commons repo; there is no separate remote to pull.
      process.stdout.write("bridges sync with the Commons repo — run 'bastra commons update' to pull the latest\n");
      return 0;
    }
    case "language": {
      const lang = opts.positional?.[2] ?? null;
      if (!lang) {
        const cur = await getSharedRecallLanguage();
        process.stdout.write(`query-language override: ${cur ?? "(auto-detect)"}\n`);
        return 0;
      }
      if (lang === "auto") {
        await clearSharedRecallLanguage();
        process.stdout.write("✓ query-language override cleared — auto-detect per query\n");
        return 0;
      }
      // Validate against the SAME set the daemon enforces at boot (SUPPORTED_LANGUAGES),
      // so the CLI never confirms an override the daemon would silently discard.
      if (!isSupportedLanguage(lang.toLowerCase())) {
        process.stderr.write(`✗ unsupported language '${lang}' — bridge pools exist only for: ${SUPPORTED_LANGUAGES.join(", ")} (or 'auto' to clear)\n`);
        return 2;
      }
      await setSharedRecallLanguage(lang);
      process.stdout.write(`✓ query-language override set to '${lang.toLowerCase()}'\n`);
      return 0;
    }
    case "mint": {
      // Offline harvest: reconstruct (far query → acted-on memory) reaches from the
      // telemetry log and mint bridges from them. Optional [days] limits the window.
      const daysArg = opts.positional?.[2];
      const days = daysArg ? parseInt(daysArg, 10) : null;
      const events = await readEventLog(undefined, days != null && Number.isFinite(days) ? days : null);
      const reaches = reconstructReaches(events);
      if (reaches.length === 0) {
        process.stdout.write("no acted-on reaches found in telemetry — nothing to mint yet\n");
        return 0;
      }
      const vaultPath = envFirst("BASTRA_VAULT_PATH", "NEXUS_VAULT_PATH");
      if (!vaultPath) {
        process.stderr.write("✗ BASTRA_VAULT_PATH not set — cannot read memory vocabulary to mint bridges\n");
        return 1;
      }
      const vault = new Vault(vaultPath);
      await vault.init();
      const getMemoryTerms = (id: string): string[] => {
        const m = vault.get(id);
        if (!m) return [];
        return distinctiveTerms([m.fm.title, m.fm.summary, ...m.fm.recall_when, ...m.fm.tags, m.body].join(" "));
      };
      const result = harvestBridges(reaches, getMemoryTerms);
      const written = await writeBridges(bridgesPath(), result.bridges);
      process.stdout.write(
        `✓ minted ${result.minted} bridge(s) from ${result.reaches} acted-on reach(es) — ${written} written to ${join(bridgesPath(), "bridges")}\n` +
          "  restart the daemon to load them\n",
      );
      return 0;
    }
    case "harvest": {
      // Teacher 2: deep harvest over the #121 far slice using the local reranker.
      const daysArg = opts.positional?.[2];
      const days = daysArg ? parseInt(daysArg, 10) : null;
      const events = await readEventLog(undefined, days != null && Number.isFinite(days) ? days : null);
      const pools = extractCandidatePools(events);
      if (pools.length === 0) {
        process.stdout.write("no candidate pools in telemetry yet (needs #121 logging + some recalls) — nothing to harvest\n");
        return 0;
      }
      const vaultPath = envFirst("BASTRA_VAULT_PATH", "NEXUS_VAULT_PATH");
      if (!vaultPath) {
        process.stderr.write("✗ BASTRA_VAULT_PATH not set — cannot read memory vocabulary\n");
        return 1;
      }
      const vault = new Vault(vaultPath);
      await vault.init();
      const getMemoryInfo = (id: string): { text: string; terms: string[] } | null => {
        const m = vault.get(id);
        if (!m) return null;
        return {
          text: `${m.fm.title} — ${m.fm.summary}`,
          terms: distinctiveTerms([m.fm.title, m.fm.summary, ...m.fm.recall_when, ...m.fm.tags, m.body].join(" ")),
        };
      };
      // Probe what Ollama actually has before firing 50 chat calls: on a machine that
      // never pulled the default model, /api/chat 404s and the run dies at case 1/50
      // with a cryptic error. Resolve to an installed model (or a clear "pull it" hint).
      const preferred = process.env.BASTRA_RERANK_MODEL ?? DEFAULT_RERANK_MODEL;
      const ollamaURL = process.env.BASTRA_OLLAMA_URL ?? "http://localhost:11434";
      let installed: string[];
      try {
        installed = await listOllamaModels();
      } catch (err) {
        process.stderr.write(
          `✗ local reranker unavailable — Ollama not reachable at ${ollamaURL} (${(err as Error).message}).\n` +
            "  start Ollama, or run 'bastra models on' to set it up.\n",
        );
        return 1;
      }
      const choice = resolveRerankModel(installed, preferred);
      if (!choice.model) {
        process.stderr.write(
          `✗ reranker model '${preferred}' is not pulled and no other chat model is installed.\n` +
            `  run 'ollama pull ${preferred}' (or set BASTRA_RERANK_MODEL to a model you already have).\n`,
        );
        return 1;
      }
      if (choice.fellBack) {
        process.stderr.write(
          `  note: '${preferred}' is not pulled — falling back to '${choice.model}'. ` +
            `run 'ollama pull ${preferred}' or set BASTRA_RERANK_MODEL to pin one.\n`,
        );
      }
      const model = choice.model;
      process.stdout.write(`harvesting far slice with local reranker (${model}) over ${pools.length} pools…\n`);
      const result = await harvestFarBridges(pools, getMemoryInfo, ollamaChat({ model }), {
        onProgress: (done, total) => process.stderr.write(`  judged ${done}/${total}\r`),
      });
      const written = await writeBridges(bridgesPath(), result.bridges);
      process.stdout.write(
        `\n✓ judged ${result.judged} far case(s) → minted ${result.minted} bridge(s) — ${written} written to ${join(bridgesPath(), "bridges")}\n` +
          "  restart the daemon to load them\n",
      );
      return 0;
    }
    case "contribute": {
      // Bridges are minted locally from successful recalls and contributed to the
      // Commons repo via PR (same flow as `bastra commons verify`). Deliberately
      // not auto-run: nothing leaves the machine without an explicit, reviewed PR.
      // Not yet wired — minting depends on #121 (the below-floor far slice is not
      // logged yet), so there is no harvested material to contribute.
      process.stderr.write(
        `contribute: not yet available — bridge minting depends on #121. Bridges will be contributed to ${COMMONS_REPO_URL.replace(/\.git$/, "")} via PR once harvesting is wired.\n`,
      );
      return 1;
    }
    case "status": {
      const enabled = await getSharedRecallEnabled();
      const langOverride = await getSharedRecallLanguage();
      // Honor the same gate as the daemon (index.ts): when disabled, the pool is
      // never built — so status must not imply a live pool either.
      const pool = enabled ? BridgePool.load(bridgesPath()) : null;
      const poolStr = pool
        ? `${pool.size()} bridges (${pool.languages().map((l) => `${l}:${pool.size(l)}`).join(" ") || "none"})`
        : "(not loaded — disabled)";
      process.stdout.write(
        `shared learned-recall: ${enabled ? "enabled" : "disabled"} · language: ${langOverride ?? "auto"} · ` +
          `pool: ${poolStr} · repo: ${join(bridgesPath(), "bridges")}\n`,
      );
      return 0;
    }
    default:
      process.stderr.write(`unknown bridges subcommand '${sub}' — use enable|disable|status|language|mint|harvest|update|contribute\n`);
      return 2;
  }
}
