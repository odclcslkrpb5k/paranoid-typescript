/**
 * The gate (SH-10, SH-11): the pre-commit hook's checks again, over everything a push would carry
 * since origin's main, and no ignored file where the check container reads. And run-node, through
 * which every TypeScript check runs: in the project's image on the workstation, or SHIP_NODE here.
 */
import assert from "node:assert/strict";
import { chmodSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { LEAK, Scratch } from "./scratch.ts";
import "../support/leaks.ts";

/** A comment the checker refuses, assembled so this file holds none. */
const NARRATION = ["// this ", "fixes the bug\n"].join("");

test("the gate runs each check as itself, fails on any, and says which", (t) => {
  const s = Scratch.create(t);
  // An ignored file the check container's build leaves out is no concern of the gate's.
  s.write("ignored.txt", "ignored\n");
  const ok = s.run("gate");
  assert.deepEqual([ok.code, ok.stderr], [0, ""]);
  assert.equal(ok.stdout, "gate: secrets, comments and ignored files pass\n");

  s.write("leak.ts", LEAK);
  const secrets = s.run("gate");
  assert.equal(secrets.code, 1);
  assert.match(secrets.stderr, /gate: secrets failed\npassword literal: 1 match\(es\)/);
  assert.ok(!secrets.stderr.includes("comments failed"), secrets.stderr);

  // It keeps going after a failure, so one run reports every check that fails.
  s.write("main.ts", `one\n${NARRATION}`);
  const both = s.run("gate");
  assert.equal(both.code, 1);
  assert.match(both.stderr, /gate: secrets failed/);
  assert.match(both.stderr, /gate: comments failed\nCD-1: these comments narrate/);
  assert.match(both.stderr, /main\.ts: "this fixes"/);

  // A checker that cannot run fails the gate; it never passes for having judged nothing.
  const c = Scratch.create(t);
  const broken = c.run("gate", [], { SHIP_NODE: "/bin/false" });
  assert.equal(broken.code, 1);
  assert.match(broken.stderr, /gate: comments failed\n.*the comment checker could not run/);
});

test("an ignored file the check container would read fails the gate, by name", (t) => {
  const s = Scratch.create(t);
  // Ignored by git (*.token) but not by the image's build: a test could read it, a commit never.
  s.write("test/fixture.token", "read by a test\n");
  const out = s.run("gate");
  assert.equal(out.code, 1);
  assert.match(
    out.stderr,
    /ignored files the check container would read[^\n]*\n {2}test\/fixture\.token\n/,
  );
  // .dockerignore names a path from the root: the same name deeper down is still read.
  const d = Scratch.create(t);
  d.write("sub/ignored.txt", "ignored by git everywhere, by the build only at the top\n");
  const deeper = d.run("gate");
  assert.equal(deeper.code, 1);
  assert.match(deeper.stderr, /\n {2}sub\/ignored\.txt\n/);
  // A .dockerignore line that is a pattern cannot be read by name, so it excuses nothing.
  const p = Scratch.create(t);
  p.write(".dockerignore", "ignored.txt\n*.token\n");
  const pattern = p.run("gate");
  assert.equal(pattern.code, 1);
  assert.match(pattern.stderr, /line 2 of \.dockerignore is not a plain name/);
});

test("the gate judges what a --no-verify commit added since origin, hook or no hook", (t) => {
  const s = Scratch.create(t);
  // Committed past the hook, then to be pushed as a resume: only the gate can still judge it.
  s.write("leak.ts", `${LEAK}${NARRATION}`);
  s.git(s.work, "add", "-A");
  s.git(s.work, "commit", "-q", "--no-verify", "-m", "past the hook");
  const out = s.run("gate");
  assert.equal(out.code, 1);
  assert.match(out.stderr, /gate: secrets failed/);
  assert.match(out.stderr, /gate: comments failed[\s\S]*leak\.ts: "this fixes"/);

  // A local branch named origin/main at HEAD would leave nothing to judge; the full name is read.
  s.git(s.work, "branch", "origin/main", "HEAD");
  const shadowed = s.run("gate");
  assert.equal(shadowed.code, 1, shadowed.stdout);
  assert.match(shadowed.stderr, /gate: secrets failed/);
});

test("the gate scans work not yet committed, and leaves ignored files out", (t) => {
  const s = Scratch.create(t);
  // Untracked, never staged: only the scratch index, built with add -A, carries it to the check.
  s.write("leak.ts", LEAK);
  const untracked = s.run("gate");
  assert.equal(untracked.code, 1);
  assert.match(untracked.stderr, /gate: secrets failed/);
  // The real index is untouched.
  assert.equal(s.git(s.work, "status", "--short"), "?? leak.ts");

  // Ignored, and left out of the image, so no commit and no test can carry it.
  const i = Scratch.create(t);
  i.write("ignored.txt", LEAK);
  const ignored = i.run("gate");
  assert.deepEqual([ignored.code, ignored.stderr], [0, ""]);
});

test("before the first push the gate judges everything, against the empty tree", (t) => {
  const s = Scratch.create(t, { bootstrap: true });
  const clean = s.run("gate");
  assert.deepEqual([clean.code, clean.stderr], [0, ""]);
  s.write("main.ts", LEAK);
  const out = s.run("gate");
  assert.equal(out.code, 1);
  assert.match(out.stderr, /gate: secrets failed/);
});

test("a tree the gate cannot index is a failure, never an empty pass", (t) => {
  const s = Scratch.create(t);
  s.write("unreadable.ts", "secret\n");
  chmodSync(path.join(s.work, "unreadable.ts"), 0o000);
  const out = s.run("gate");
  chmodSync(path.join(s.work, "unreadable.ts"), 0o644);
  assert.equal(out.code, 1);
  assert.match(out.stderr, /the tree could not be indexed/);
});

test("run-node runs the image with no network and the tree read-only, or SHIP_NODE if set", (t) => {
  const s = Scratch.create(t);
  const id = (flag: string): string => s.exec("id", [flag]).stdout.trim();
  const out = s.run("run-node", ["--deps", "tools/ship/check-comments.ts", "a b"], {
    SHIP_NODE: "",
  });
  assert.equal(out.code, 0, out.stderr);
  assert.equal(
    readFileSync(path.join(s.dir, "calls"), "utf8"),
    [
      "run --rm -i --network none",
      `-u ${id("-u")}:${id("-g")}`,
      `-v ${s.work}:/repo:ro -v /repo/node_modules -w /repo`,
      "app:dev node tools/ship/check-comments.ts a b\n",
    ].join(" "),
  );
  // Without --deps, no volume for node_modules; with SHIP_NODE, that node and no docker at all.
  s.run("run-node", ["x.ts"], { SHIP_NODE: "" });
  assert.match(
    readFileSync(path.join(s.dir, "calls"), "utf8"),
    /:ro -w \/repo app:dev node x\.ts\n$/,
  );
  const direct = s.run("run-node", ["-e", "console.log(process.argv.length)", "z"]);
  assert.deepEqual([direct.code, direct.stdout], [0, "2\n"]);
  const usage = s.run("run-node", ["--deps"]);
  assert.equal(usage.code, 2);
  assert.match(usage.stderr, /usage: run-node/);
});
