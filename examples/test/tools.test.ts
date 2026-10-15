/**
 * The tools' logic, tested as pure functions. Each checker is shown to fail on what it exists to
 * catch, since a checker that cannot fail looks exactly like a clean codebase (TS-5).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkRejected, checkTypes, loadOptions } from "../tools/check-fixtures.ts";
import { addedLines, findCoercions } from "../tools/coercions.ts";
import { escapeHidden, findHidden } from "../tools/hidden-chars.ts";
import { decide, deserialize, parseTscOutput, serialize } from "../tools/tsc-baseline.ts";
import { must } from "./support/assert.ts";
import "./support/leaks.ts";

const root = path.dirname(import.meta.dirname);

/**
 * A temporary fixture directory. Its package.json makes `.ts` files ES modules under `nodenext`,
 * as they are in the project; without it they compile as CommonJS and fail for the wrong reason.
 */
function scratch(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "fixtures-"));
  writeFileSync(path.join(dir, "package.json"), '{ "type": "module" }\n');
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}

test("check-fixtures reports a fixture that compiles, an option without one, and a stray", () => {
  const { options } = loadOptions(path.join(root, "tsconfig.json"));
  const booleans = new Map([
    ["noUnusedLocals", true],
    ["noUnusedParameters", true],
  ]);
  const dir = scratch({
    "noUnusedLocals.ts": "export const used = 1;\n",
    "allowUnusedLabels.ts": "export {};\n",
  });
  try {
    const findings = checkRejected(dir, options, booleans);
    const problems = findings.map((f) => f.problem);
    assert.ok(problems.some((p) => p.includes("compiles with noUnusedLocals set")));
    assert.ok(problems.some((p) => p.includes("noUnusedParameters has no fixture")));
    const stray = must(
      findings.find((f) => f.problem.includes("does not set")),
      "the stray finding",
    );
    assert.equal(stray.fixture, path.join(dir, "allowUnusedLabels.ts"));
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("check-fixtures reports a type fixture with the wrong error, or an extra one", () => {
  const { options } = loadOptions(path.join(root, "tsconfig.json"));
  const dir = scratch({
    "wrong.ts": "// expect TS2345\nexport const x: number = 'text';\n",
    "extra.ts": [
      "// expect TS2345",
      "declare function f(n: number): void;",
      "f('text');",
      "export const y: number = 'text';",
    ].join("\n"),
  });
  try {
    const problems = checkTypes(dir, options)
      .map((f) => `${path.basename(f.fixture)}: ${f.problem}`)
      .sort();
    assert.deepEqual(problems, [
      "extra.ts: expected TS2345, got TS2345, TS2322",
      "wrong.ts: expected TS2345, got TS2322",
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("tsc-baseline counts errors by file and code, global errors included", () => {
  const output = [
    "src/a.ts(1,1): error TS2532: Object is possibly 'undefined'.",
    "src/a.ts(9,4): error TS2532: Object is possibly 'undefined'.",
    "error TS2688: Cannot find type definition file for 'missing'.",
    "  a continuation line that is not an error",
  ].join("\n");
  assert.deepEqual(
    parseTscOutput(output),
    new Map([
      ["src/a.ts\tTS2532", 2],
      ["(global)\tTS2688", 1],
    ]),
  );
});

test("tsc-baseline refuses a raised allowance, a rise and an unrecorded fix", () => {
  const base = new Map([["src/a.ts\tTS2532", 2]]);
  const tree = new Map([
    ["src/a.ts\tTS2532", 3],
    ["src/c.ts\tTS2322", 1],
  ]);
  const current = new Map([
    ["src/a.ts\tTS2532", 3],
    ["src/b.ts\tTS7006", 1],
  ]);
  assert.deepEqual(decide(current, tree, base), {
    raised: ["src/a.ts\tTS2532: 2 -> 3", "src/c.ts\tTS2322: 0 -> 1"],
    rising: ["src/b.ts\tTS7006: 0 -> 1"],
    stale: ["src/c.ts\tTS2322: 0 -> 1"],
  });
});

test("tsc-baseline passes a change that fixes an error and records the smaller baseline", () => {
  const base = new Map([["src/a.ts\tTS2532", 2]]);
  const fixed = new Map([["src/a.ts\tTS2532", 1]]);
  assert.deepEqual(decide(fixed, fixed, base), { raised: [], rising: [], stale: [] });
});

test("tsc-baseline accepts a first baseline when the base has none", () => {
  const first = new Map([["src/a.ts\tTS2532", 5]]);
  assert.deepEqual(decide(first, first, undefined), { raised: [], rising: [], stale: [] });
});

test("tsc-baseline round-trips its file and refuses one that is malformed", () => {
  const counts = new Map([["src/a.ts\tTS2532", 2]]);
  assert.deepEqual(deserialize(serialize(counts)), counts);
  for (const bad of ["", "{}", '{"version":2,"counts":{}}', '{"version":1,"counts":{"a":0}}']) {
    assert.equal(deserialize(bad), undefined, `accepted ${bad}`);
  }
});

test("coercions reads added lines by hunk counts, so a line beginning '++' is not a header", () => {
  const diff = [
    "diff --git a/x.ts b/x.ts",
    "--- a/x.ts",
    "+++ b/x.ts",
    "@@ -3,0 +4,2 @@",
    "+const a = value as Thing;",
    "++++ b/fake-header.ts as Header",
    "@@ -10 +12 @@",
    "-old",
    "\\ No newline at end of file",
    "+const n = Number(text);",
    "\\ No newline at end of file",
  ].join("\n");
  assert.deepEqual(addedLines(diff), [
    { line: 4, text: "const a = value as Thing;" },
    { line: 5, text: "+++ b/fake-header.ts as Header" },
    { line: 12, text: "const n = Number(text);" },
  ]);
});

test("coercions numbers added lines past context lines", () => {
  const diff = ["@@ -1,3 +1,4 @@", " first", "-second", "+changed", "+added", " third"].join("\n");
  assert.deepEqual(addedLines(diff), [
    { line: 2, text: "changed" },
    { line: 3, text: "added" },
  ]);
});

test("coercions stops each hunk at its counts, so the next header is never read as context", () => {
  const diff = ["@@ -1,2 +1,3 @@", " one", "+two", " three", "@@ -9,1 +10,2 @@", " nine", "+ten"];
  assert.deepEqual(addedLines(diff.join("\n")), [
    { line: 2, text: "two" },
    { line: 11, text: "ten" },
  ]);
});

test("coercions names each kind, and leaves the look-alikes alone", () => {
  const cases: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["const a = b as Thing;", ["as-cast"]],
    ["const a = b as unknown as Thing;", ["as-cast", "as-unknown-as"]],
    ["const a = <Thing>b;", ["angle-cast"]],
    ["use(row!.id);", ["non-null"]],
    ["let late!: string;", ["definite-assignment"]],
    ["function f(x: any) {}", ["any"]],
    ["type Loose = any;", ["any"]],
    ["const ok = !!flag;", ["double-negation"]],
    ["const n = +text;", ["unary-plus"]],
    ["const s = `${+text}`;", ["unary-plus"]],
    ["function isX(v: unknown): v is X {", ["type-predicate"]],
    ["function check(v: unknown): asserts v is X {", ["type-predicate"]],
    ["select (p ->> 'id')::int", ["sql-cast"]],
  ];
  for (const [line, kinds] of cases) assert.deepEqual(findCoercions(line), kinds, line);
  const innocent = [
    "const k = ['a'] as const;",
    "if (a !== b) {}",
    "const s = a + b;",
    "import * as v from 'valibot';",
    "// Read as text, as the parser expects.",
    " * as the comment says",
  ];
  for (const line of innocent) assert.deepEqual(findCoercions(line), [], line);
});

test("hidden-chars finds each kind of hidden character, and escapes it", () => {
  const points = [0xa0, 0x200b, 0x202e, 0x2066, 0x2028, 0xfeff, 0x061c, 0xe0041];
  const text = points.map((p, i) => `line ${String(i)}: a${String.fromCodePoint(p)}b`).join("\n");
  assert.deepEqual(
    findHidden(text).map((hit) => hit.codePoint),
    ["U+00A0", "U+200B", "U+202E", "U+2066", "U+2028", "U+FEFF", "U+061C", "U+E0041"],
  );
  const escaped = escapeHidden(text);
  assert.deepEqual(findHidden(escaped), []);
  assert.ok(escaped.includes("\\u00a0") && escaped.includes("\\u{e0041}"));
});
