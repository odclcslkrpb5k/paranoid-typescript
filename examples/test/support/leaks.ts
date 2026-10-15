/**
 * Fails any test that leaves a timer, socket or server behind (TS-3). Importing this module
 * registers the hooks for every test in the importing file; a test in `meta.test.ts` checks that
 * every test file does import it.
 *
 * It compares the kinds of active resources Node reports before and after each test. Timers are
 * judged at once: a cleared timer is gone immediately, so one still listed is a leak, however soon
 * it would fire. Sockets and servers that are already closing need a few turns of the event loop to
 * go, so for them it waits up to `SETTLE_MS` for the counts to come back down.
 *
 * Limits: Node reports only handles that keep the event loop alive, so an `unref()`'d timer or
 * socket is invisible here; a handle that appears more than a few milliseconds after its test ends
 * is missed; and counts are per kind, so a resource closing and a new one of the same kind leaking
 * in the same test cancel out. Review covers these.
 */
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach } from "node:test";

function counts(): Map<string, number> {
  const tally = new Map<string, number>();
  for (const kind of process.getActiveResourcesInfo()) tally.set(kind, (tally.get(kind) ?? 0) + 1);
  return tally;
}

const SETTLE_MS = 200;

let before = new Map<string, number>();

function leakedSince(baseline: Map<string, number>): string[] {
  return [...counts()]
    .filter(([kind, n]) => n > (baseline.get(kind) ?? 0))
    .map(([kind, n]) => `${kind} (+${String(n - (baseline.get(kind) ?? 0))})`);
}

beforeEach(() => {
  before = counts();
});

/** Kinds that disappear the moment they are cleared, so they get no settling window. */
const TIMERS = new Set(["Timeout", "Immediate"]);

afterEach(async () => {
  const timers = leakedSince(before).filter((entry) => TIMERS.has(entry.split(" ")[0] ?? ""));
  assert.deepEqual(timers, [], `the test left timers pending: ${timers.join(", ")}`);
  // Some handles appear only once an operation started in the test completes (a server is listed
  // after its `listen` finishes), so a little time passes before anything else is judged.
  await sleep(10);
  const deadline = Date.now() + SETTLE_MS;
  let leaked = leakedSince(before);
  while (leaked.length > 0 && Date.now() < deadline) {
    // The sleep's own timer is gone again by the time the counts are taken.
    await sleep(10);
    leaked = leakedSince(before);
  }
  assert.deepEqual(leaked, [], `the test left resources open: ${leaked.join(", ")}`);
});
