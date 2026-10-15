/**
 * Tests of the test suite itself: that its checks are switched on everywhere, and that they can
 * fail. A check that never fails looks exactly like a codebase that never breaks it (TS-5, TS-6).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { findHidden } from "../tools/hidden-chars.ts";
import "./support/leaks.ts";

const root = path.dirname(import.meta.dirname);

/** Every file under `dir` (relative to the project), recursively, skipping installed packages. */
function walk(dir: string): string[] {
  return readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
    .map((name) => path.join(dir, name))
    .filter((name) => !name.includes("node_modules"));
}

/** The files the test command's `test/**\/*.test.ts` glob selects. */
const testFiles = walk("test").filter((name) => name.endsWith(".test.ts"));

test("test discovery finds the suite", () => {
  // Only a guard against discovery itself breaking and finding nothing, which would make the
  // check below pass vacuously.
  assert.ok(testFiles.length >= 5, `found only ${testFiles.join(", ")}`);
});

test("every test file registers the leak check", () => {
  const missing = testFiles.filter((name) => {
    const text = readFileSync(path.join(root, name), "utf8");
    const relative = path.relative(path.dirname(name), "test/support/leaks.ts");
    return !text.includes(`import "./${relative}";`) && !text.includes(`import "${relative}";`);
  });
  assert.deepEqual(missing, []);
});

/** Runs one fixture under its own test runner and returns what it printed and how it ended. */
function runFixture(file: string): { readonly status: number | null; readonly stdout: string } {
  // A runner started from inside a test inherits NODE_TEST_CONTEXT and reports to its parent
  // instead of failing on its own, which would make these pass whatever the leak check does.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT"),
  );
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=spec", file], {
    encoding: "utf8",
    env,
    cwd: root,
  });
  return { status: run.status, stdout: run.stdout };
}

test("the leak check fails a test that leaves a timer pending", () => {
  const run = runFixture("test/fixtures/leaky/leaks-a-timer.ts");
  assert.notEqual(run.status, 0, "the leaky fixture passed, so the leak check checks nothing");
  assert.match(run.stdout, /left timers pending: Timeout/);
});

test("the leak check fails a timer shorter than its settling window", () => {
  const run = runFixture("test/fixtures/leaky/leaks-a-short-timer.ts");
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /left timers pending: Timeout/);
});

test("the leak check fails a test that leaves a server listening", () => {
  const run = runFixture("test/fixtures/leaky/leaks-a-server.ts");
  assert.notEqual(run.status, 0);
  assert.match(run.stdout, /left resources open: TCPServerWrap/);
});

test("no source file holds a literal hidden character (CD-7)", () => {
  const sources = [
    ...walk("src"),
    ...walk("test"),
    ...walk("tools"),
    ...walk("lint"),
    "eslint.config.js",
    "package.json",
    "tsconfig.json",
    "README.md",
  ].filter((name) => /\.(?:ts|js|json|md)$/.test(name));
  assert.ok(sources.length >= 20, "the scan found too few files to be scanning the project");
  const hits = sources.flatMap((name) =>
    findHidden(readFileSync(path.join(root, name), "utf8")).map(
      (hit) => `${name}:${String(hit.line)}: ${hit.codePoint}`,
    ),
  );
  assert.deepEqual(hits, []);
});
