/**
 * The CLI's only interactive prompt. TTY-gated by design: in any
 * non-interactive context (piped stdin, a hook, CI, a detached background
 * process) confirm() resolves `false` immediately without reading stdin, so
 * unattended `bastra install` runs never block waiting for input that will
 * never come. This is load-bearing for the staged auto-update path.
 */
import { createInterface } from "node:readline/promises";

/** True only when BOTH stdin and stdout are real TTYs. */
export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * y/N confirmation, default No. Returns false in any non-interactive context
 * and on EOF / Ctrl-C during the prompt. Never throws.
 */
export async function confirm(question: string): Promise<boolean> {
  if (!isInteractive()) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } catch {
    // SIGINT (Ctrl-C) rejects the pending question() — treat as "no".
    return false;
  } finally {
    rl.close();
  }
}
