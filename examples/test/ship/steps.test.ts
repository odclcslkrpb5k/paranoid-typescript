/**
 * tools/ship/steps, which runs a ship's final steps (SH-11): the gate, then the suite, then each
 * step required-steps calls for (SH-13), each under timed, stopping at the first failure. What it
 * runs is what commit-and-push then requires, so a tree it passed ships.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { LEAK, Scratch, SHIP } from "./scratch.ts";
import "../support/leaks.ts";

const RULES = `${SHIP}/required-steps`;
const E2E = "docker compose run --build --rm e2e";

/** The labels of the steps the ledger recorded, in the order they ran. */
function ran(s: Scratch): string[] {
  return s.ledger().map((row) => row[0] ?? "");
}

/** The docker commands the fake docker was asked to run, in order. */
function calls(s: Scratch): string[] {
  const file = path.join(s.dir, "calls");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
}

test("every step runs in order, and the tree they passed against ships", (t) => {
  const s = Scratch.create(t);
  s.write(RULES, `^ui/\tre: build\t${E2E}\n^db/\tre: never\t${E2E} --never\n`);
  s.write("ui/page.ts", "page\n");
  const out = s.run("steps");
  assert.equal(out.code, 0, out.stderr);
  assert.deepEqual(ran(s), ["gate", "test", "re: build"]);
  assert.deepEqual(calls(s), ["compose run --build --rm check", "compose run --build --rm e2e"]);
  assert.match(out.stdout, /every step passed/);
  assert.ok(s.ledger().every((row) => row[2] === s.hash() && row[3] === s.hash()));
  const shipped = s.ship(s.hash());
  assert.equal(shipped.code, 0, shipped.stderr);
});

test("a failed gate runs nothing after it", (t) => {
  const s = Scratch.create(t);
  s.write(RULES, `^ui/\tre: build\t${E2E}\n`);
  s.write("ui/page.ts", LEAK);
  const out = s.run("steps");
  assert.notEqual(out.code, 0);
  assert.match(out.stderr, /'gate' failed .* no later step ran/);
  assert.deepEqual(ran(s), ["gate"]);
  assert.deepEqual(calls(s), []);
});

test("a failed suite runs no required step, and its status is the run's", (t) => {
  const s = Scratch.create(t);
  s.write(RULES, `^ui/\tre: build\t${E2E}\n`);
  s.write("ui/page.ts", "page\n");
  const out = s.run("steps", [], { FAIL: "check" });
  assert.equal(out.code, 1, out.stderr);
  assert.match(out.stderr, /'test' failed \(exit 1\); no later step ran/);
  assert.deepEqual(ran(s), ["gate", "test"]);
  assert.deepEqual(calls(s), ["compose run --build --rm check"]);
});

test("a path no rule names runs the gate and the suite only", (t) => {
  const s = Scratch.create(t);
  s.write(RULES, `^ui/\tre: build\t${E2E}\n`);
  s.write("main.ts", "two\n");
  const out = s.run("steps");
  assert.equal(out.code, 0, out.stderr);
  assert.deepEqual(ran(s), ["gate", "test"]);
});

test("origin's rules count, so a ship cannot drop the step it needs", (t) => {
  const s = Scratch.create(t);
  s.landOnOrigin("rules", { [RULES]: `^ui/\tre: build\t${E2E}\n`, "ui/page.ts": "page\n" });
  s.write(RULES, "# none\n");
  s.write("ui/page.ts", "changed\n");
  const out = s.run("steps");
  assert.equal(out.code, 0, out.stderr);
  assert.deepEqual(ran(s), ["gate", "test", "re: build"]);
});

test("a malformed rule stops the run before any step", (t) => {
  const s = Scratch.create(t);
  s.write(RULES, `^(ui\tre: build\t${E2E}\n`);
  s.write("ui/page.ts", "page\n");
  const out = s.run("steps");
  assert.equal(out.code, 1, out.stderr);
  assert.match(out.stderr, /line 1 of tools\/ship\/required-steps is not a valid extended regex/);
  assert.deepEqual(ran(s), []);
  assert.deepEqual(calls(s), []);
});
