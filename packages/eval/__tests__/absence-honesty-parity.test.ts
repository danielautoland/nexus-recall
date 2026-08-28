/**
 * The absence-honesty harness re-implements `weak_result` / `no_home` so that
 * `@bastra-recall/eval` does not have to depend on the daemon workspace. A
 * re-implementation is a drift risk: the harness would keep reporting on a
 * predicate the daemon no longer has, and nobody would notice, because both
 * sides would be internally consistent.
 *
 * So compare the two texts. Not the behaviour — the SOURCE. If
 * `core/src/weak-result.ts` changes its predicate bodies, this fails and the
 * harness gets updated with it.
 *
 * The predicate moved from `daemon/src` to `core/src` with the M1 measurement
 * (#262): the gold-set runner calls it directly now. This harness still carries
 * its own copy, so the guard stays — but the copy is no longer NECESSARY, and
 * replacing it with the core import is the cleanup that retires this file.
 *
 * Runner: node --import tsx --test packages/eval/__tests__/absence-honesty-parity.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const harness = readFileSync(path.join(here, "..", "src", "absence-honesty.ts"), "utf8");
const shipped = readFileSync(
  path.join(here, "..", "..", "core", "src", "weak-result.ts"),
  "utf8",
);

/** Code only. The two copies are allowed to carry different prose — the daemon
 *  explains itself to a maintainer, the harness to whoever reruns the numbers. */
function stripComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The body of `export function <name>` / `function <name>`, braces balanced. */
function bodyOf(source: string, name: string): string {
  const start = source.search(new RegExp(`(export )?function ${name}\\(`));
  assert.notEqual(start, -1, `${name} not found`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return stripComments(source.slice(open, i + 1));
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

for (const fn of ["hitTitleMatches", "isWeakResult", "isNoHome"]) {
  test(`${fn}: the eval copy still matches the daemon`, () => {
    assert.equal(
      bodyOf(harness, fn),
      bodyOf(shipped, fn),
      `${fn} drifted — packages/eval/src/absence-honesty.ts must be updated to match ` +
        "packages/core/src/weak-result.ts, or the harness is measuring a predicate that no longer ships",
    );
  });
}
