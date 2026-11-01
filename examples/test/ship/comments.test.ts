/**
 * The comment checker (CD-1): what it reads as a comment, and the script that hands it each staged
 * file. Narrating comments are assembled at run time or held inside strings, so this file passes
 * the checker it tests.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addedInHunks,
  commentText,
  judgeStaged,
  narration,
  report,
} from "../../tools/ship/check-comments.ts";
import { Scratch } from "./scratch.ts";
import "../support/leaks.ts";

const FIX = ["this ", "fixes the bug"].join("");

test("each comment syntax is read: //, /* */ and its continuation lines, #, and SQL --", () => {
  assert.equal(commentText("src/a.ts", `const x = 1; // ${FIX}`), FIX);
  assert.equal(commentText("src/a.ts", `/* ${FIX} */`), `${FIX} */`);
  assert.equal(commentText("src/a.ts", ` * ${FIX}`), FIX);
  assert.equal(commentText("tools/ship/gate", `# ${FIX}`), FIX);
  assert.equal(commentText("compose.yaml", `  x: 1 # ${FIX}`), FIX);
  assert.equal(commentText("db/functions/a.sql", `select 1; -- ${FIX}`), FIX);
  assert.equal(commentText("db/functions/a.sql", `/* ${FIX}`), FIX);
  // Inside a string, after a character that joins it to code, or a shebang: not a comment.
  assert.equal(commentText("src/a.ts", `const u = "http://x/${FIX}";`), null);
  assert.equal(commentText("src/a.ts", `const s = "a // ${FIX}";`), null);
  assert.equal(commentText("tools/ship/gate", `echo 'a # ${FIX}'`), null);
  assert.equal(commentText("src/a.ts", "const r = a//b;"), null);
  assert.equal(commentText("tools/ship/gate", "#!/usr/bin/env -S bash -p"), null);
  assert.equal(commentText("db/a.sql", "select a-- b"), null);
});

test("prose, data and vendored files are not judged", () => {
  for (const path of ["docs/guide.ts", "README.md", "vendor/x/a.ts", "package.json", "a.txt"]) {
    assert.equal(commentText(path, `// ${FIX}`), null, path);
    assert.deepEqual(narration(path, [`// ${FIX}`, `# ${FIX}`]), [], path);
  }
});

test("each tell is found, and the ordinary words around them are not", () => {
  const tells = [
    "formerly the queue",
    "not needed anymore",
    FIX,
    ["this ", "commit adds"].join(""),
    ["fixes ", "a regression"].join(""),
    ["we ", "switched to"].join(""),
    ["previously ", "returned null"].join(""),
    ["used to be ", "called x"].join(""),
    ["no longer ", "needed"].join(""),
    ["now ", "returns a Result"].join(""),
    ["the old ", "behaviour"].join(""),
  ];
  for (const tell of tells) {
    assert.equal(narration("src/a.ts", [`// ${tell}`]).length, 1, tell);
  }
  const durable = [
    "the row was deleted by the caller",
    "now() is the transaction's start",
    "a fix for this is tracked in the notes",
    "returns what the caller previously stored",
  ];
  for (const comment of durable) {
    assert.deepEqual(narration("src/a.ts", [`// ${comment}`]), [], comment);
  }
});

test("the staged input is read as name and diff pairs, and only added lines count", () => {
  const diff = [
    "diff --git a/x.ts b/x.ts",
    "+++ b/x.ts",
    "@@ -1 +1 @@",
    `-// ${FIX}`,
    `+// ${FIX}`,
    "+const ok = 1;",
  ].join("\n");
  assert.deepEqual(addedInHunks(diff), [`// ${FIX}`, "const ok = 1;"]);
  const findings = judgeStaged(`x.ts\0${diff}\0vendor/y.ts\0${diff}\0`);
  assert.deepEqual(findings, [{ file: "x.ts", comment: FIX, tell: "this fixes" }]);
  assert.match(report(findings), /^CD-1: these comments narrate[\s\S]*x\.ts: "this fixes" in:/);
});

test("comments_check.sh judges every staged file by its own name, and fails closed", (t) => {
  const names = ['q"x.ts', "with space.ts", "café.ts", "*.ts", ":(glob)x.ts", "-dash.ts"];
  const s = Scratch.create(t);
  // A file whose name is a pathspec matching the others would hand them all over as one.
  for (const name of names) s.write(name, `// ${FIX}\n`);
  s.write("vendor/upstream.ts", `// ${FIX}\n`);
  s.git(s.work, "add", "-A");
  const out = s.run("comments_check.sh");
  assert.equal(out.code, 1, out.stderr);
  for (const name of names) {
    assert.ok(out.stderr.includes(`  ${name}: "this fixes"`), `${name}: ${out.stderr}`);
  }
  assert.ok(!out.stderr.includes("vendor/"), out.stderr);
  // Only what is added: the same comment already committed is not judged again.
  s.git(s.work, "commit", "-q", "--no-verify", "-m", "past the hook");
  s.write("main.ts", "two\n");
  s.git(s.work, "add", "-A");
  assert.equal(s.run("comments_check.sh").code, 0);
  // A checker that cannot run is the check's own failure, not a pass and not a finding.
  const broken = s.run("comments_check.sh", [], { SHIP_NODE: "/bin/false" });
  assert.equal(broken.code, 3);
  assert.match(broken.stderr, /the comment checker could not run/);
  // Before the first commit, everything staged is judged against the empty tree.
  const b = Scratch.create(t, { bootstrap: true });
  b.write("main.ts", `// ${FIX}\n`);
  b.git(b.work, "add", "-A");
  assert.equal(b.run("comments_check.sh").code, 1);
});
