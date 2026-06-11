/**
 * `bastra commons` — Bastra Commons, der Community-Rezept-Vault.
 *
 * Git-first: `enable` clont (bzw. pullt) das Commons-Repo nach
 * ~/.bastra/commons und setzt `commons.enabled` in cli-settings.json; der
 * Daemon lädt das Verzeichnis beim nächsten Boot als read-only BM25-Index
 * und fusioniert Treffer (scope "commons") in recall — leicht unter den
 * persönlichen Memories gerankt. Es wird NIE in das Repo geschrieben;
 * Beiträge laufen über PRs (siehe Commons-CONTRIBUTING).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { arch, homedir, platform } from "node:os";
import { join, basename } from "node:path";
import { findExecutable, run } from "./exec.js";
import { getCommonsEnabled, setCommonsEnabled } from "../settings.js";

export const COMMONS_REPO_URL = process.env.BASTRA_COMMONS_REPO ?? "https://github.com/n0mad-ai/bastra-commons.git";

export function commonsPath(): string {
  return process.env.BASTRA_COMMONS_PATH ?? join(homedir(), ".bastra", "commons");
}

export async function cmdCommons(opts: { sub: string | null; positional?: string[] }): Promise<number> {
  const sub = opts.sub ?? "status";
  switch (sub) {
    case "verify":
      // bastra commons verify <recipe-id> <works|fails> ["environment note"]
      return await cmdVerify(opts.positional?.[2] ?? null, opts.positional?.[3] ?? null, opts.positional?.[4] ?? null);
    case "enable": {
      const rc = await cloneOrPull();
      if (rc !== 0) return rc;
      await setCommonsEnabled(true);
      process.stdout.write("✓ commons enabled — restart the daemon (or your AI client) to load it\n");
      return 0;
    }
    case "update": {
      if (!existsSync(commonsPath())) {
        process.stdout.write("commons not cloned yet — run 'bastra commons enable' first\n");
        return 1;
      }
      return await cloneOrPull();
    }
    case "disable": {
      await setCommonsEnabled(false);
      process.stdout.write("✓ commons disabled (clone kept at " + commonsPath() + ") — restart the daemon to apply\n");
      return 0;
    }
    case "status": {
      const enabled = await getCommonsEnabled();
      const cloned = existsSync(join(commonsPath(), "recipes"));
      process.stdout.write(`commons: ${enabled ? "enabled" : "disabled"} · clone: ${cloned ? commonsPath() : "not cloned"}\n`);
      return 0;
    }
    default:
      process.stderr.write(`unknown commons subcommand '${sub}' — use enable|update|disable|status|verify\n`);
      return 2;
  }
}

// ─── verify-Loop (das Herzstück) ─────────────────────────────────────────────
// Ein Verification-Record ist die kleinste Beweis-Einheit: "works/fails for
// me" + Umgebung. Ein Record pro Verifier+Rezept — die Datei wird bei
// Meinungsänderung überschrieben, die Historie liegt im git-Log (append-only
// durch git, nicht durch uns). Aus den Records entsteht die Hitlist: Status
// wird berechnet, nie vergeben.

export interface VerificationRecord {
  recipe_id: string;
  result: "works" | "fails";
  environment: { os: string; arch: string; node: string; note: string | null };
  verifier: string;
  date: string;
}

export function buildVerificationRecord(
  recipeId: string,
  result: "works" | "fails",
  note: string | null,
  verifier: string,
  date: string = new Date().toISOString().slice(0, 10),
): VerificationRecord {
  return {
    recipe_id: recipeId,
    result,
    environment: { os: platform(), arch: arch(), node: process.version, note },
    verifier,
    date,
  };
}

export function verificationRecordPath(rootDir: string, recipeId: string, verifier: string): string {
  return join(rootDir, "verifications", recipeId, `${verifier}.json`);
}

/** Pseudonymer, stabiler Verifier-Schlüssel: Kurzhash der git-Mail. Der
 *  Klarname steht ohnehin im PR; der Hash macht nur den Dateinamen
 *  deterministisch ("ein Record pro User+Solution"). */
function verifierId(): string {
  const r = spawnSync("git", ["config", "user.email"], { stdio: ["ignore", "pipe", "ignore"], timeout: 5_000 });
  const email = r.status === 0 ? String(r.stdout).trim() : "";
  const seed = email || `${homedir()}`;
  return createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

/** Liest alle Records unter <root>/verifications → counts pro Rezept-ID.
 *  Synchron + defensiv; der Daemon ruft das einmal beim Boot. */
export function loadVerificationCounts(rootDir: string): Map<string, { works: number; fails: number }> {
  const counts = new Map<string, { works: number; fails: number }>();
  const base = join(rootDir, "verifications");
  try {
    for (const recipeDir of readdirSync(base, { withFileTypes: true })) {
      if (!recipeDir.isDirectory()) continue;
      const entry = { works: 0, fails: 0 };
      for (const f of readdirSync(join(base, recipeDir.name))) {
        if (!f.endsWith(".json")) continue;
        try {
          const rec = JSON.parse(readFileSync(join(base, recipeDir.name, f), "utf8")) as { result?: string };
          if (rec.result === "works") entry.works++;
          else if (rec.result === "fails") entry.fails++;
        } catch {
          /* skip corrupt record */
        }
      }
      counts.set(recipeDir.name, entry);
    }
  } catch {
    /* no verifications dir yet */
  }
  return counts;
}

/** Evidenz → Ranking: Basis-Dämpfung 0.8 (persönliche Memories gewinnen),
 *  unabhängige works heben (bis +0.15), fails senken. Geclampt, damit ein
 *  Rezept nie über persönliche Hits hinaus geboostet wird oder ganz
 *  verschwindet — Abstieg ist sichtbar, nicht Zensur. */
export function commonsRankFactor(works: number, fails: number): number {
  const factor = 0.8 + Math.min(0.15, works * 0.05) - Math.min(0.25, fails * 0.08);
  return Math.max(0.5, Math.min(0.95, factor));
}

async function cmdVerify(recipeId: string | null, result: string | null, note: string | null): Promise<number> {
  if (!recipeId || (result !== "works" && result !== "fails")) {
    process.stderr.write("usage: bastra commons verify <recipe-id> <works|fails> [\"environment note\"]\n");
    return 2;
  }
  const root = commonsPath();
  if (!existsSync(join(root, ".git"))) {
    process.stderr.write("commons not cloned — run 'bastra commons enable' first\n");
    return 1;
  }
  if (!findRecipeFile(root, recipeId)) {
    process.stderr.write(`✗ recipe '${recipeId}' not found in ${join(root, "recipes")}\n`);
    return 1;
  }

  const verifier = verifierId();
  const record = buildVerificationRecord(recipeId, result, note, verifier);
  const recordPath = verificationRecordPath(root, recipeId, verifier);
  mkdirSync(join(root, "verifications", recipeId), { recursive: true });
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  process.stdout.write(`✓ verification recorded: ${recipeId} → ${result} (${basename(recordPath)})\n`);

  // Submission als Mini-PR — best-effort: gelingt git/gh nicht, bleibt der
  // Record lokal liegen und der Pfad wird ausgegeben (manuell einreichbar).
  const git = findExecutable("git");
  const gh = findExecutable("gh");
  if (!git) {
    process.stdout.write(`→ submit manually: open a PR adding ${recordPath}\n`);
    return 0;
  }
  const branch = `verify/${recipeId}-${verifier}-${result}`;
  const steps: [string[], string][] = [
    [["-C", root, "checkout", "-B", branch], "branch"],
    [["-C", root, "add", recordPath], "add"],
    [["-C", root, "commit", "-m", `verify: ${recipeId} ${result} (${verifier})`], "commit"],
    [["-C", root, "push", "-u", "origin", branch, "--force-with-lease"], "push"],
  ];
  for (const [args, label] of steps) {
    const r = run(git, args, { timeoutMs: 60_000 });
    if (!r.ok) {
      process.stdout.write(`→ ${label} failed (${r.detail}) — record kept at ${recordPath}; submit manually\n`);
      run(git, ["-C", root, "checkout", "main"], { timeoutMs: 15_000 });
      return 0;
    }
  }
  if (gh) {
    const pr = spawnSync(gh, ["pr", "create", "--repo", COMMONS_REPO_URL.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, ""), "--head", branch, "--title", `verify: ${recipeId} → ${result}`, "--body", `Verification record from \`bastra commons verify\`:\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``], { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
    if (pr.status === 0) process.stdout.write(`✓ verification PR opened: ${String(pr.stdout).trim()}\n`);
    else process.stdout.write(`→ branch '${branch}' pushed — open the PR manually (gh pr create failed)\n`);
  } else {
    process.stdout.write(`→ branch '${branch}' pushed — open a PR to submit your verification\n`);
  }
  run(git, ["-C", root, "checkout", "main"], { timeoutMs: 15_000 });
  return 0;
}

function findRecipeFile(rootDir: string, recipeId: string): string | null {
  const recipes = join(rootDir, "recipes");
  try {
    for (const domain of readdirSync(recipes, { withFileTypes: true })) {
      if (!domain.isDirectory()) continue;
      const candidate = join(recipes, domain.name, `${recipeId}.md`);
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* no recipes dir */
  }
  return null;
}

async function cloneOrPull(): Promise<number> {
  const git = findExecutable("git");
  if (!git) {
    process.stderr.write("✗ git not found on a trusted PATH\n");
    return 1;
  }
  const path = commonsPath();
  if (existsSync(join(path, ".git"))) {
    process.stdout.write(`→ updating commons (${path})\n`);
    const r = run(git, ["-C", path, "pull", "--ff-only"], { timeoutMs: 120_000, showProgress: true });
    if (!r.ok) {
      process.stderr.write(`✗ git pull failed (${r.detail})\n`);
      return 1;
    }
  } else {
    process.stdout.write(`→ cloning ${COMMONS_REPO_URL} → ${path}\n`);
    const r = run(git, ["clone", "--depth", "1", COMMONS_REPO_URL, path], { timeoutMs: 300_000, showProgress: true });
    if (!r.ok) {
      process.stderr.write(`✗ git clone failed (${r.detail}) — is the repo reachable for your account?\n`);
      return 1;
    }
  }
  process.stdout.write("✓ commons up to date\n");
  return 0;
}
