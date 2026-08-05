/**
 * Band occupancy at the shipped constants — the t0 for #302's open door.
 *
 * #302 closed with the wording fixed and the cuts left where they were, because
 * #335 moved the scale under them (RRF_K 60 -> 5). The maintainer left one
 * thing open: "if the occupancy still reads wrong after #335 has run against a
 * real vault for a while, that door is open."
 *
 * That check needs a BEFORE. This is it: the same split #302 measured
 * (dropped <30 / OPTIONAL 30..99 / REQUIRED >=100, plus the bash-fail floor at
 * 50), re-run on a real vault at the constants actually shipped, with the arm
 * decomposition read from `RecallHit.rrf` rather than inferred from `mode`.
 *
 * WHAT THIS IS NOT: the queries are each memory's own declared `recall_when`
 * phrase. That is circular by construction — the same upper bound the eval
 * README flags on the M0 baseline — so the OCCUPANCY here is the friendliest
 * case the bands will ever see. It is a valid t0 only against itself: the
 * comparison later must re-run this same script, not a different query source.
 * Live hook traffic is the honest denominator and this is not it.
 *
 *   BASTRA_VAULT_PATH=~/zzalli-vault npx tsx src/band-occupancy.ts --n 400 --out t0.json
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  Vault,
  SearchIndex,
  EmbeddingIndex,
  OllamaEmbeddingProvider,
  RRF_K,
  RRF_SCALE,
} from "@bastra-recall/core";

const FLOOR = 30;
const MUST_LOAD = 100;
const BASH_FAIL_FLOOR = 50;

interface Row {
  query: string;
  k: number;
  id: string;
  score: number;
  rank_bm25: number | null;
  rank_vector: number | null;
  band: "dropped" | "optional" | "required";
  arms: 1 | 2 | 0;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (n: string, d: string): string => {
    const i = argv.indexOf(n);
    return i === -1 ? d : (argv[i + 1] ?? d);
  };
  const vaultRoot = (process.env.BASTRA_VAULT_PATH ?? arg("--vault", "")).replace(/^~/, os.homedir());
  const n = Number.parseInt(arg("--n", "400"), 10);
  const ks = arg("--k", "3,10,30").split(",").map((s) => Number.parseInt(s, 10));
  const outPath = arg("--out", "");
  if (!vaultRoot) {
    console.error("FATAL: set BASTRA_VAULT_PATH (or --vault)");
    process.exit(2);
  }
  const embSrc = path.join(vaultRoot, ".bastra", "embeddings.json");
  if (!(await fs.stat(embSrc).catch(() => null))) {
    console.error(`FATAL: ${embSrc} not found — run the daemon once on this vault first.`);
    process.exit(2);
  }

  const vault = new Vault(vaultRoot);
  await vault.init();
  const search = new SearchIndex(vault);
  search.start();
  const provider = new OllamaEmbeddingProvider({
    baseURL: process.env.BASTRA_OLLAMA_URL ?? "http://localhost:11434",
    model: process.env.BASTRA_EMBEDDING_MODEL ?? "embeddinggemma",
    keepAlive: "10m",
  });
  // Same discipline as pool-depth.ts: work off a COPY, the vault is an input.
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "band-occupancy-"));
  const embWork = path.join(work, "embeddings.json");
  await fs.copyFile(embSrc, embWork);
  const emb = new EmbeddingIndex(vault, provider, embWork, path.join(work, "cache.json"));
  await emb.start();
  search.useEmbeddings(emb);

  // Two query sources, and which one is used IS the angle (blocker-protocol 4a).
  //
  //   default  — one trigger phrase per memory. A query the vault CAN answer.
  //              Circular, friendliest case, and the angle #302 already took.
  //   --queries — a file of one query per line, off-vault by intent. The angle
  //              #230/#239 establish: an absolute cut only means something if
  //              the score means something when there is nothing to find. The
  //              floor exists for exactly this case, so this is where it has to
  //              be measured. Re-running the default is not a second look.
  const queriesFile = arg("--queries", "");
  const queries = queriesFile
    ? (await fs.readFile(queriesFile, "utf8"))
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("#"))
        .slice(0, n)
        .map((q) => ({ id: q, q }))
    : vault
        .list()
        .map((m) => ({ id: m.fm.id, q: m.fm.recall_when?.[0] ?? "" }))
        .filter((x) => x.q.trim().length > 0)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, n);

  console.error(
    `vault ${vault.size()} memories, ${emb.size()} vectors, ${queries.length} queries` +
      `, RRF_K=${RRF_K} RRF_SCALE=${RRF_SCALE.toFixed(2)}`,
  );
  // The inversion #302 shipped, printed so the bands can be read as ranks.
  for (const cut of [FLOOR, BASH_FAIL_FLOOR, MUST_LOAD]) {
    console.error(
      `  cut ${String(cut).padStart(3)} -> two-armed to rank ${Math.floor((2 * RRF_SCALE) / cut - RRF_K)}` +
        `, one-armed to rank ${Math.floor(RRF_SCALE / cut - RRF_K)}`,
    );
  }

  const rows: Row[] = [];
  for (const k of ks) {
    for (const { q } of queries) {
      const hits = await search.recallHybrid(q, { k });
      for (const h of hits) {
        const rb = h.rrf?.rank_bm25 ?? null;
        const rv = h.rrf?.rank_vector ?? null;
        const arms = ((rb !== null ? 1 : 0) + (rv !== null ? 1 : 0)) as 0 | 1 | 2;
        rows.push({
          query: q,
          k,
          id: h.id,
          score: h.score,
          rank_bm25: rb,
          rank_vector: rv,
          band: h.score >= MUST_LOAD ? "required" : h.score >= FLOOR ? "optional" : "dropped",
          arms,
        });
      }
    }
  }

  const pct = (a: number, b: number): string => (b === 0 ? "  n/a" : `${((100 * a) / b).toFixed(1)}%`);
  for (const k of ks) {
    const r = rows.filter((x) => x.k === k);
    const req = r.filter((x) => x.band === "required");
    const opt = r.filter((x) => x.band === "optional");
    const drop = r.filter((x) => x.band === "dropped");
    console.log(`\n── k=${k}  (${r.length} hits over ${queries.length} queries) ──`);
    console.log(
      `  REQUIRED >=100   ${pct(req.length, r.length).padStart(6)}` +
        `   — ${pct(req.filter((x) => x.arms === 2).length, req.length)} found by BOTH arms` +
        `, ${pct(req.filter((x) => x.arms === 1).length, req.length)} by one`,
    );
    console.log(
      `  OPTIONAL 30..99  ${pct(opt.length, r.length).padStart(6)}` +
        `   — ${pct(opt.filter((x) => x.arms === 1).length, opt.length)} found by ONE arm`,
    );
    console.log(`  dropped   <30    ${pct(drop.length, r.length).padStart(6)}`);
    console.log(`  above bash-fail floor (>=50): ${pct(r.filter((x) => x.score >= BASH_FAIL_FLOOR).length, r.length)}`);
    const scores = r.map((x) => x.score).sort((a, b) => a - b);
    const med = scores.length ? scores[Math.floor(scores.length / 2)] : 0;
    console.log(`  top-hit score median ${med.toFixed(1)}, max ${Math.max(...scores, 0).toFixed(1)}`);
    const perQuery = new Map<string, Row[]>();
    for (const x of r) perQuery.set(x.query, [...(perQuery.get(x.query) ?? []), x]);
    const allReq = [...perQuery.values()].filter((v) => v.every((x) => x.band === "required")).length;
    const anyOpt = [...perQuery.values()].filter((v) => v.some((x) => x.band === "optional")).length;
    console.log(`  queries where EVERY served hit is REQUIRED: ${pct(allReq, perQuery.size)}`);
    console.log(`  queries with any OPTIONAL hit at all:       ${pct(anyOpt, perQuery.size)}`);
  }

  await emb.stop();
  search.stop();
  await vault.stop();
  if (outPath) {
    await fs.writeFile(
      outPath,
      JSON.stringify({ at: new Date().toISOString(), rrf_k: RRF_K, rrf_scale: RRF_SCALE, rows }, null, 2),
    );
    console.error(`\nwrote ${outPath}`);
  }
}

void main();
