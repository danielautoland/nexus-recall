/**
 * The map's memory counter agrees with the statusline again (#294).
 *
 * It was seeded once from graph.vault_size and then only ever nudged by the
 * per-poll delta, read back out of its own displayed text. Two paths drop
 * events without a nudge — a buffer overflow past the client's cursor, and a
 * daemon restart that rebaselines it — so a long-lived tab accumulated a number
 * that recorded how many events IT had missed, not how many memories exist.
 *
 * Runner: `node --import tsx --test packages/daemon/__tests__/memory-counter.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — plain browser module, no types (same as the map modules
// live-updates.test.ts pulls in).
import { createMemoryCounter } from "../webui/js/managers/memory-counter.js";

/** Stands in for the DOM element: what is displayed, and what the vault says. */
function harness(displayed: number | null, vaultSize: number | null = null) {
  const state = { displayed, vaultSize, fetches: 0, writes: 0, failNext: false };
  const counter = createMemoryCounter({
    read: () => state.displayed,
    write: (n: number) => {
      state.displayed = n;
      state.writes++;
    },
    fetchSize: async () => {
      state.fetches++;
      if (state.failNext) {
        state.failNext = false;
        throw new Error("daemon away");
      }
      return state.vaultSize;
    },
    reconcileEveryPolls: 20,
  });
  return { state, counter };
}

test("the delta still moves the number immediately", () => {
  const h = harness(622);
  h.counter.bump(1);
  assert.equal(h.state.displayed, 623, "live mode has to react within the poll");
  h.counter.bump(-2);
  assert.equal(h.state.displayed, 621);
});

test("a zero delta is not an event", () => {
  const h = harness(622);
  h.counter.bump(0);
  assert.equal(h.state.writes, 0, "no write, so no pulse animation for nothing");
});

test("nothing displayed yet: the delta is dropped, not applied to NaN", () => {
  const h = harness(null);
  h.counter.bump(3);
  assert.equal(h.state.displayed, null);
});

test("a reconcile overwrites a drifted total from the vault", async () => {
  const h = harness(618, 622); // tab missed four births
  await h.counter.reconcile();
  assert.equal(h.state.displayed, 622, "the vault is the authority, not the accumulated total");
});

test("a reconcile that finds no change writes nothing", async () => {
  const h = harness(622, 622);
  await h.counter.reconcile();
  assert.equal(h.state.writes, 0, "an unchanged number must not pulse every 30 s");
});

test("an unreachable daemon leaves the number alone", async () => {
  const h = harness(622, 999);
  h.state.failNext = true;
  await h.counter.reconcile();
  assert.equal(h.state.displayed, 622, "a wrong number is worse than a late one");
  // And the next attempt goes through.
  await h.counter.reconcile();
  assert.equal(h.state.displayed, 999);
});

test("a non-numeric answer is ignored", async () => {
  const h = harness(622, null);
  await h.counter.reconcile();
  assert.equal(h.state.displayed, 622);
});

// ─── cadence ─────────────────────────────────────────────────────────────────

test("the slow reconcile fires on cadence, not on every poll", async () => {
  const h = harness(600, 622);
  for (let i = 0; i < 19; i++) h.counter.afterPoll();
  assert.equal(h.state.fetches, 0, "19 polls must not hit /health 19 times");
  h.counter.afterPoll();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.state.fetches, 1);
  assert.equal(h.state.displayed, 622);
});

test("an explicit reconcile restarts the cadence", async () => {
  const h = harness(600, 622);
  for (let i = 0; i < 15; i++) h.counter.afterPoll();
  await h.counter.reconcile(); // e.g. the daemon-restart path
  for (let i = 0; i < 19; i++) h.counter.afterPoll();
  assert.equal(h.state.fetches, 1, "the counter was just measured — no second fetch right after");
  h.counter.afterPoll();
  await Promise.resolve();
  assert.equal(h.state.fetches, 2);
});

test("the drift scenario from the issue converges instead of persisting", async () => {
  // 622 in the vault, tab shows 622. A burst overflows the buffer: eight births
  // are dropped before the client polls, so no delta ever arrives for them.
  const h = harness(622, 630);
  // ... the old code would sit at 622 until someone reloaded the page.
  assert.equal(h.state.displayed, 622);
  await h.counter.reconcile(); // what the overflow path now does
  assert.equal(h.state.displayed, 630);
});
