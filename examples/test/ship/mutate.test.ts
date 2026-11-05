/**
 * mutate (TS-5): it applies one mutant, judges it by the test runner's count of failing tests in
 * the mutant's run, and puts the file back byte for byte, whatever happens to the command; a
 * mutant that does not compile, a command that fails while no test fails, or a run that judges
 * nothing, is never counted as a kill. TypeScript is compiled with tsc over tsconfig.json's
 * program, JavaScript checked with `node --check`, shell with `bash -n`.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { type Out, ROOT, Scratch, SHIP } from "./scratch.ts";
import "../support/leaks.ts";

const GUARD = "if (x < 0) throw new Error();\n";

/** The name of the one test `asTest` runs: the reason its failure is named by. */
const GUARDED = "the guard holds";

/** A shell command that, when `check` fails, reports one failing test as node:test does. */
function asTest(check: string): string {
  return `{ ${check}; } || { echo "\u2716 ${GUARDED}"; echo "\u2139 fail 1"; exit 1; }`;
}

/** `command` run as a test: on failure it reports one failing test. */
function tested(...command: string[]): string[] {
  return ["sh", "-c", asTest('"$@"'), "sh", ...command];
}

function mutations(s: Scratch): string[] {
  const file = path.join(s.work, ".git/ship-mutations");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

function inconclusive(s: Scratch, out: Out, reason: string, file: string, original: string): void {
  assert.equal(out.code, 2, out.stderr);
  assert.ok(out.stderr.includes(reason), `expected "${reason}" in: ${out.stderr}`);
  assert.equal(s.read(file), original);
}

/** A process that runs alongside the test, and the promise of its exit status. */
async function background(
  s: Scratch,
  script: string,
  args: readonly string[],
): Promise<number | null> {
  const child = spawn(path.join(s.work, SHIP, script), args, {
    cwd: s.work,
    env: s.env(),
    stdio: "ignore",
  });
  return await new Promise((resolve) => {
    child.on("exit", (code) => {
      resolve(code);
    });
  });
}

async function until(condition: () => boolean, what: string): Promise<void> {
  for (const deadline = Date.now() + 10_000; Date.now() < deadline;) {
    if (condition()) return;
    await sleep(5);
  }
  assert.fail(`${what} never happened`);
}

test("a mutant is applied, judged by its run's failing tests, and the file put back byte for byte", (t) => {
  const s = Scratch.create(t);
  // Two trailing newlines and a multi-line guard: what a careless rewrite would lose.
  const original = "function ok(x) {\n  if (x < 0) {\n    throw new Error();\n  }\n}\n\n";
  s.write("guard.txt", original);
  const check = tested("grep", "-q", "x < 0", "guard.txt");
  const mutate = (find: string, replace: string, ...command: string[]): Out =>
    s.run("mutate", ["guard.txt", find, replace, GUARDED, "--", ...command]);

  // The guard removed: the test fails, so the mutant is killed.
  const killed = mutate("  if (x < 0) {\n", "  if (false) {\n", ...check);
  assert.deepEqual(
    [killed.code, killed.stdout.split("\n")[0]],
    [0, "mutate: killed: guard.txt:   if (x < 0) {"],
  );
  assert.equal(s.read("guard.txt"), original);

  // A change the test cannot see: it survives, and says so.
  const survived = mutate("throw new Error();", "return;", ...check);
  assert.equal(survived.code, 1, survived.stderr);
  assert.match(survived.stdout, /SURVIVED/);
  assert.equal(s.read("guard.txt"), original);

  // The mutated file keeps everything but the change, trailing newlines included, so a check of
  // its shape does not kill a mutant for a reason that is not the mutant.
  const shape = mutate(
    "throw new Error();",
    "throw new TypeError();",
    "sh",
    "-c",
    '[ "$(tail -c 2 guard.txt | od -An -c | tr -d " ")" = "\\n\\n" ]',
  );
  assert.equal(shape.code, 1, shape.stdout);
  assert.deepEqual(
    mutations(s).map((line) => line.split("\t")[0]),
    ["killed", "SURVIVED", "SURVIVED"],
  );
});

test("a mutant is killed only by a failing test the runner counts, never by a failure alone", (t) => {
  const s = Scratch.create(t);
  s.write("guard.txt", GUARD);
  const mutate = (script: string): Out =>
    s.run("mutate", ["guard.txt", "x < 0", "MUTANT", GUARDED, "--", "sh", "-c", script]);
  const onMutant = "grep -q MUTANT guard.txt";
  // A formatter or linter refusing the mutant, while every test passes: no verdict.
  for (const script of [
    `${onMutant} && exit 1; exit 0`,
    `${onMutant} && { echo "\u2139 fail 0"; exit 1; }; exit 0`,
    `${onMutant} && { echo "# fail 0"; echo "# cancelled 0"; exit 1; }; exit 0`,
    // A count printed by the run without the mutant is not the mutant's.
    `${onMutant} || echo "\u2139 fail 1"; ${onMutant} && exit 1; exit 0`,
    // Playwright's count is indented and above 0; anything else is no count.
    `${onMutant} && { echo "2 failed"; exit 1; }; exit 0`,
    `${onMutant} && { echo "  0 failed"; exit 1; }; exit 0`,
  ]) {
    inconclusive(s, mutate(script), "but no test failed", "guard.txt", GUARD);
  }
  assert.deepEqual(mutations(s), []);
  // The spec reporter's count, in colour or not, a test cut off by its timeout, TAP's and
  // Playwright's.
  for (const report of [
    "\u2139 fail 2",
    "\u2139 cancelled 1",
    "  2 failed",
    "\\033[31m\u2139 fail 1\\033[39m",
    "# fail 1",
  ]) {
    const out = mutate(
      `${onMutant} && { echo "\u2716 ${GUARDED}"; printf '%b\\n' "${report}"; exit 1; }; exit 0`,
    );
    assert.equal(out.code, 0, out.stderr);
  }
  assert.deepEqual(
    mutations(s).map((line) => line.split("\t")[0]),
    ["killed", "killed", "killed", "killed", "killed"],
  );
});

test("a mutant is killed only when its own log shows the reason it was named for", (t) => {
  const s = Scratch.create(t);
  s.write("guard.txt", GUARD);
  const mutate = (reason: string, script: string): Out =>
    s.run("mutate", ["guard.txt", "x < 0", "MUTANT", reason, "--", "sh", "-c", script]);
  const onMutant = "grep -q MUTANT guard.txt";
  const failing = (says: string): string =>
    `${onMutant} && { echo "${says}"; echo "\u2139 fail 1"; exit 1; }; exit 0`;
  // A runner's count of failures names no test, so it is never the reason.
  for (const [reason, summary] of [
    ["fail [0-9]", ""],
    ["fail [0-9]", "# fail 1"],
    ["[0-9] failed", "  1 failed"],
    ["failing tests", "\u2716 failing tests:"],
  ] as const) {
    inconclusive(s, mutate(reason, failing(summary)), "never shows", "guard.txt", GUARD);
  }
  // A test failed, but for another cause than the one named: no verdict.
  inconclusive(
    s,
    mutate("rejects a negative", failing("connect ECONNREFUSED")),
    "never shows the reason named",
    "guard.txt",
    GUARD,
  );
  // The reason in the run without the mutant is not the mutant's.
  inconclusive(
    s,
    mutate(
      "rejects a negative",
      `${onMutant} || echo "rejects a negative"; ${onMutant} && { echo "\u2139 fail 1"; exit 1; }; exit 0`,
    ),
    "never shows the reason named",
    "guard.txt",
    GUARD,
  );
  // The named test passed while another failed: its name in a passing line is no reason.
  for (const passed of [
    "\u2714 rejects a negative",
    "  \u2713  3 rejects a negative",
    "ok 1 - rejects a negative",
    "# Subtest: rejects a negative\nok 1 - rejects a negative",
  ]) {
    inconclusive(
      s,
      mutate("rejects a negative", failing(`${passed}\n\u2716 an unrelated test`)),
      "never shows the reason named",
      "guard.txt",
      GUARD,
    );
  }
  // A group fails when any test in it does, so its own failure names none: node's spec reporter
  // heads it with ▶ and closes it with ✖ at the same indent, and TAP marks its not ok.
  const spec = [
    "\u25b6 a group of checks",
    "  \u2716 rejects a negative (1.4ms)",
    "  \u2714 accepts zero (0.1ms)",
    "\u2716 a group of checks (2.6ms)",
  ].join("\n");
  const tap = [
    "# Subtest: a group of checks",
    "    # Subtest: rejects a negative",
    "    not ok 1 - rejects a negative",
    "      ---",
    "      failureType: 'testCodeFailure'",
    "      ...",
    "not ok 1 - a group of checks",
    "  ---",
    "  failureType: 'subtestsFailed'",
    "  ...",
  ].join("\n");
  for (const log of [spec, tap]) {
    inconclusive(
      s,
      mutate("a group of checks", failing(log)),
      "a group's own failure is not read",
      "guard.txt",
      GUARD,
    );
  }
  // Playwright lists by name a test that failed and then passed on a retry: no reason either.
  inconclusive(
    s,
    mutate(
      "rejects a negative",
      failing(
        "  1 failed\n    [chromium] \u203a an unrelated test\n  1 flaky\n    [chromium] \u203a rejects a negative",
      ),
    ),
    "never shows the reason named",
    "guard.txt",
    GUARD,
  );
  assert.deepEqual(mutations(s), []);
  const killed = mutate("rejects a (negative|zero)", failing("not ok 1 - rejects a negative"));
  assert.equal(killed.code, 0, killed.stderr);
  // A test inside a group is named by its own failure, in either reporter.
  for (const log of [spec, tap]) {
    const leaf = mutate("rejects a negative", failing(log));
    assert.equal(leaf.code, 0, leaf.stderr);
  }
  // The reason early in a log far longer than a pipe holds.
  const long = mutate(
    "rejects a negative",
    `${onMutant} && { echo "not ok 1 - rejects a negative"; head -c 300000 /dev/zero | tr '\\0' x; echo; echo "\u2139 fail 1"; exit 1; }; exit 0`,
  );
  assert.equal(long.code, 0, long.stderr);
  assert.deepEqual(
    mutations(s).map((line) => line.split("\t")[0]),
    ["killed", "killed", "killed", "killed"],
  );
  // A reason that is empty or no pattern is refused before anything runs.
  inconclusive(
    s,
    mutate("", "touch ran"),
    "reason the mutant's log must show is empty",
    "guard.txt",
    GUARD,
  );
  inconclusive(
    s,
    mutate("(unclosed", "touch ran"),
    "not an extended regular expression",
    "guard.txt",
    GUARD,
  );
  // So is one any failing log meets, which names no failure.
  for (const anything of [
    ".",
    ".*",
    "^",
    "x?",
    "e",
    "[^x]",
    "AssertionError",
    "failureType",
    "ERR_TEST_FAILURE",
    "subtest failed",
  ]) {
    inconclusive(
      s,
      mutate(anything, "touch ran"),
      "any failing log meets the reason",
      "guard.txt",
      GUARD,
    );
  }
  assert.equal(existsSync(path.join(s.work, "ran")), false);
});

test("a mutant that judges nothing is inconclusive, and the file is left as it was", (t) => {
  const s = Scratch.create(t);
  s.write("guard.txt", GUARD);
  const mutate = (find: string, ...command: string[]): Out =>
    s.run("mutate", ["guard.txt", find, "MUTANT", GUARDED, "--", ...command]);
  const check = (out: Out, reason: string): void => {
    inconclusive(s, out, reason, "guard.txt", GUARD);
  };
  // Text that is not there, or none: nothing applied, nothing run.
  check(mutate("nowhere", "sh", "-c", "touch ran"), "does not contain");
  check(mutate("", "true"), "the text to change is empty");
  assert.equal(existsSync(path.join(s.work, "ran")), false);
  // A test that already fails, or cannot run: no mutant can be judged by it.
  check(mutate("x < 0", "false"), "fails without the mutant");
  check(mutate("x < 0", "no-such-command"), "fails without the mutant");
  // A command that cannot run, or dies, only once mutated.
  check(
    mutate("x < 0", "sh", "-c", "grep -q MUTANT guard.txt && exit 127; exit 0"),
    "could not run with the mutant",
  );
  check(
    mutate("x < 0", "sh", "-c", "grep -q MUTANT guard.txt && kill -SEGV $$; exit 0"),
    "died of a signal",
  );
  // A file that cannot be written - for anyone but root, whom a mode does not stop.
  if (process.getuid?.() !== 0) {
    chmodSync(path.join(s.work, "guard.txt"), 0o444);
    check(mutate("x < 0", "true"), "cannot read and write");
    chmodSync(path.join(s.work, "guard.txt"), 0o644);
  }
  // A binary file, which bash would carry in a corrupted form.
  s.write("blob.bin", Buffer.from([120, 0, 121]));
  const binary = s.run("mutate", ["blob.bin", "x", "z", GUARDED, "--", "true"]);
  assert.equal(binary.code, 2);
  assert.match(binary.stderr, /NUL bytes/);
  assert.deepEqual([...readFileSync(path.join(s.work, "blob.bin"))], [120, 0, 121]);
  // A usage error.
  assert.equal(s.run("mutate", ["guard.txt", "x", "y", "true"]).code, 2);
  // None of these is a verdict, so none was recorded as one.
  assert.deepEqual(mutations(s), []);
});

/** A scratch repository with a TypeScript project of its own, checked by the real tsc. */
function project(t: Parameters<typeof Scratch.create>[0]): Scratch {
  const s = Scratch.create(t);
  symlinkSync(path.join(ROOT, "node_modules"), path.join(s.work, "node_modules"));
  s.write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
        lib: ["es2024"],
        target: "es2024",
        module: "nodenext",
        allowImportingTsExtensions: true,
      },
      include: ["src"],
    }),
  );
  s.write(
    "src/guard.ts",
    "export function ok(x: number): void {\n  if (x < 0) {\n    throw new Error();\n  }\n}\n",
  );
  s.write(
    "src/f.ts",
    "export function f(x: number): number {\n  return String(x).length + 1;\n}\n",
  );
  s.write("src/f.test.ts", 'import { f } from "./f.ts";\nexport const two: number = f(1);\n');
  return s;
}

test("a mutant that does not compile is its own outcome, not a kill, and the file is put back", (t) => {
  const s = project(t);
  const runs = (): number => (s.exists("runs") ? s.read("runs").split("\n").length - 1 : 0);
  // Each command counts its runs and fails on its mutant, so a mutant that ran would be killed.
  const counted = (check: string): string[] => ["sh", "-c", `echo >> runs; ${asTest(check)}`];
  const mutate = (file: string, find: string, replace: string, command: readonly string[]): Out =>
    s.run("mutate", [file, find, replace, GUARDED, "--", ...command]);
  const uncompiled = (
    file: string,
    find: string,
    replace: string,
    command: readonly string[],
  ): void => {
    const original = s.read(file);
    const before = runs();
    const out = mutate(file, find, replace, command);
    assert.equal(out.code, 2, out.stderr);
    assert.match(out.stderr, /the mutant does not compile/);
    // Recorded whole, as its own outcome, like any verdict.
    const id = /recorded as ([0-9a-f]{16});/.exec(out.stderr)?.[1] ?? "none";
    assert.match(
      readFileSync(path.join(s.work, ".git/ship-mutants", id, "verdicts"), "utf8"),
      /\tuncompiled\t[0-9a-f]{64}\n$/,
    );
    assert.equal(s.read(file), original);
    // The baseline ran, the mutant did not, and no copy was left behind.
    if (command.some((arg) => arg.startsWith("echo >> runs")))
      assert.equal(runs(), before + 1, file);
    const left = readdirSync(path.join(s.work, ".git/ship-mutate")).filter((n) =>
      n.endsWith(".orig"),
    );
    assert.deepEqual(left, []);
  };

  // TypeScript: a syntax error, a type error, and a type error only in an importer, which the
  // project's whole program shows.
  const tsTest = counted(
    "grep -q 'x: number): void {' src/guard.ts && grep -q 'x < 0) {' src/guard.ts",
  );
  uncompiled("src/guard.ts", "x < 0) {", "x < 0 {", tsTest);
  uncompiled("src/guard.ts", "x: number", "x: numbr", tsTest);
  uncompiled("src/f.ts", "x: number", "x: string", counted("grep -q 'x: number' src/f.ts"));
  // JavaScript goes through node --check, not bash: this mutant is valid shell.
  s.write("m.mjs", 'export const yes = "yes";\n');
  uncompiled("m.mjs", '"yes";', '"yes" +;', counted("grep -q 'yes\";$' m.mjs"));

  // Shell scripts, by each spelling of a shell shebang and by name.
  const sh = 'if [ "$1" = x ]; then\n  echo yes\nfi\n';
  for (const shebang of [
    "#!/usr/bin/env bash",
    "#!/bin/sh",
    "#! /bin/bash -e",
    "#!/usr/bin/env -S bash -eu",
  ]) {
    s.write("tool", `${shebang}\n${sh}`);
    uncompiled("tool", "fi\n", "\n", counted("bash tool x | grep -q yes"));
  }
  // An unmatched quote fails bash -n without the words "syntax error".
  s.write("tool", `#!/bin/sh\n${sh}`);
  uncompiled("tool", '"$1"', '"$1', counted("bash tool x | grep -q yes"));
  for (const name of ["lib.sh", "lib.bash"]) {
    s.write(name, sh);
    uncompiled(name, "fi\n", "\n", counted(`bash ${name} x | grep -q yes`));
  }

  // What has no check is judged by the command: none is passed to bash, which refuses all three.
  s.write("script", '#!/usr/bin/env python3\nprint("yes")\n');
  s.write("q.sql", "select 1;\n");
  s.write("z", '#!/bin/zsh\nprint("yes")\n');
  for (const [file, find, replace] of [
    ["script", '"yes"', '"no"'],
    ["z", '"yes"', '"no"'],
    ["q.sql", "select 1", "select 2"],
  ] as const) {
    const out = mutate(file, find, replace, tested("grep", "-q", find, file));
    assert.equal(out.code, 0, out.stderr);
  }
  // A TypeScript mutant that compiles is still judged by the command.
  const killed = mutate("src/guard.ts", "x < 0) {", "x < 1) {", tsTest);
  assert.deepEqual(
    [killed.code, killed.stdout.split("\n")[0]],
    [0, "mutate: killed: src/guard.ts: x < 0) {"],
  );

  assert.deepEqual(
    mutations(s).map((line) => line.split("\t").slice(0, 2).join(" ")),
    [
      "uncompiled src/guard.ts",
      "uncompiled src/guard.ts",
      "uncompiled src/f.ts",
      "uncompiled m.mjs",
      "uncompiled tool",
      "uncompiled tool",
      "uncompiled tool",
      "uncompiled tool",
      "uncompiled tool",
      "uncompiled lib.sh",
      "uncompiled lib.bash",
      "killed script",
      "killed z",
      "killed q.sql",
      "killed src/guard.ts",
    ],
  );
  assert.equal(mutations(s)[0], "uncompiled\tsrc/guard.ts\tx < 0) {");
});

test("a compile check that fails for a reason that is not the code judges nothing", (t) => {
  // A node that fails the type check without a type error - a container that would not start - or
  // is killed, always or only once the file is mutated; anything else goes to the real node.
  const s = project(t);
  const fake = path.join(s.dir, "broken-node");
  writeFileSync(
    fake,
    [
      "#!/bin/sh",
      'case "$*" in *tsc*)',
      '  if [ -z "$ONLY_MUTANT" ] || grep -q "x < 0 {" src/guard.ts; then',
      '    echo "Cannot connect to the Docker daemon"',
      // A killed check may have printed a type error first; its exit still says it did not finish.
      '    [ "$CODE" -ge 124 ] && echo "src/guard.ts(1,1): error TS2322: printed before it died"',
      '    exit "$CODE"',
      "  fi ;;",
      "esac",
      `exec ${process.execPath} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const original = s.read("src/guard.ts");
  for (const code of ["1", "124", "126", "127", "137"]) {
    for (const onlyMutant of ["", "1"]) {
      const out = s.run(
        "mutate",
        [
          "src/guard.ts",
          "x < 0) {",
          "x < 0 {",
          GUARDED,
          "--",
          "grep",
          "-q",
          "x < 0) {",
          "src/guard.ts",
        ],
        { SHIP_NODE: fake, CODE: code, ONLY_MUTANT: onlyMutant },
      );
      inconclusive(
        s,
        out,
        `for a reason that is not the code (tsc, exit ${code})`,
        "src/guard.ts",
        original,
      );
    }
  }
  assert.deepEqual(mutations(s), []);

  // A file that does not compile as it is cannot have its mutants judged.
  s.write("src/broken.ts", "export const n: number = ;\n");
  const refused = s.run("mutate", ["src/guard.ts", "x < 0", "x < 1", GUARDED, "--", "true"]);
  inconclusive(
    s,
    refused,
    "src/guard.ts does not compile without the mutant (tsc, exit",
    "src/guard.ts",
    original,
  );
  rmSync(path.join(s.work, "src/broken.ts"));
  // Nor can one tsc never reads, or one with no tsconfig.json to read it by.
  s.write("outside.ts", "export const n = 1;\n");
  const outside = s.run("mutate", ["outside.ts", "n = 1", "n = 2", GUARDED, "--", "true"]);
  inconclusive(
    s,
    outside,
    "outside.ts is not part of tsconfig.json's program",
    "outside.ts",
    "export const n = 1;\n",
  );
  rmSync(path.join(s.work, "tsconfig.json"));
  const unconfigured = s.run("mutate", ["src/guard.ts", "x < 0", "x < 1", GUARDED, "--", "true"]);
  inconclusive(s, unconfigured, "there is no tsconfig.json", "src/guard.ts", original);
  // And a run from where git finds no work tree.
  const inGitDir = s.exec(
    path.join(s.work, SHIP, "mutate"),
    ["../src/guard.ts", "x < 0", "x < 9", GUARDED, "--", "true"],
    {
      cwd: path.join(s.work, ".git"),
    },
  );
  inconclusive(
    s,
    inGitDir,
    "the top of the work tree could not be found",
    "src/guard.ts",
    original,
  );
  assert.deepEqual(mutations(s), []);
});

test("a mutate run cannot start while a ship step runs, nor a step while mutate runs", async (t) => {
  const s = Scratch.create(t);
  s.write("guard.txt", "x < 0\n");
  // The step marks that it has started, then reads the file for as long as a mutant could stay.
  const step = background(s, "timed", [
    "read",
    "sh",
    "-c",
    "touch started; sleep 2; grep -q 'x < 0' guard.txt",
  ]);
  await until(() => s.exists("started"), "the step's start");
  const during = s.run("mutate", ["guard.txt", "x < 0", "x < 1", GUARDED, "--", "true"]);
  assert.equal(during.code, 2);
  assert.match(during.stderr, /another mutate or a ship step is running/);
  assert.equal(await step, 0, "the step read the original throughout");
  assert.equal(s.read("guard.txt"), "x < 0\n");

  // Two runs at once: the second is refused, on any file, and so is a ship step.
  const slow = background(s, "mutate", [
    "guard.txt",
    "x < 0",
    "x < 2",
    GUARDED,
    "--",
    "sh",
    "-c",
    "grep -q 'x < 2' guard.txt && sleep 2; exit 0",
  ]);
  await until(() => s.read("guard.txt").includes("x < 2"), "the first run's mutant");
  s.write("other.txt", "x\n");
  const second = s.run("mutate", ["other.txt", "x", "y", GUARDED, "--", "true"]);
  const gate = s.run("timed", ["gate", "true"]);
  assert.equal(await slow, 1, "the first run survives: its test passes either way");
  assert.equal(second.code, 2);
  assert.match(second.stderr, /another mutate or a ship step is running in this repository/);
  assert.equal(gate.code, 2);
  assert.match(gate.stderr, /a mutate run is in progress/);
  assert.equal(s.read("guard.txt"), "x < 0\n");
  assert.equal(s.read("other.txt"), "x\n");
});

test("an interrupted mutate restores the file; one that never finished is refused until put back", (t) => {
  const s = Scratch.create(t);
  s.write("guard.txt", GUARD);
  const file = path.join(s.work, "guard.txt");

  // A signal while the mutated command runs.
  const interrupted = s.run("mutate", [
    "guard.txt",
    "x < 0",
    "x < 1",
    GUARDED,
    "--",
    "sh",
    "-c",
    "grep -q 'x < 1' guard.txt && kill -TERM $PPID; exit 0",
  ]);
  assert.equal(interrupted.code, 130, interrupted.stderr);
  assert.equal(s.read("guard.txt"), GUARD);

  // The command replaces the file with a directory: it cannot be restored, and says where the
  // original is - which then stops the next run until it is put back.
  const wrecked = s.run("mutate", [
    "guard.txt",
    "x < 0",
    "x < 1",
    GUARDED,
    "--",
    "sh",
    "-c",
    "grep -q 'x < 1' guard.txt 2>/dev/null && { rm guard.txt; mkdir guard.txt; exit 1; }; exit 0",
  ]);
  assert.equal(wrecked.code, 2);
  // Not restored is not a verdict: nothing printed or recorded as killed.
  assert.ok(!wrecked.stdout.includes("killed"), wrecked.stdout);
  assert.deepEqual(mutations(s), []);
  const kept = /its original is at (\S+)/.exec(wrecked.stderr)?.[1] ?? "";
  assert.notEqual(kept, "", wrecked.stderr);
  assert.equal(readFileSync(kept, "utf8"), GUARD);
  // The file is not the original - the case the leftover copy exists for - so nothing proceeds.
  rmSync(file, { recursive: true });
  s.write("guard.txt", `${GUARD}edited since\n`);
  const refused = s.run("mutate", ["guard.txt", "x", "y", GUARDED, "--", "true"]);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /never finished/);
  // Nor does a ship step, which would read whatever the file now holds.
  const step = s.run("timed", ["gate", "true"]);
  assert.equal(step.code, 2);
  assert.ok(step.stderr.includes(`is the original of ${realpathSync(file)}.`), step.stderr);
  // Nor a run on another file, whose command would read this one's mutant.
  s.write("other.txt", "x\n");
  const elsewhere = s.run("mutate", ["other.txt", "x", "y", GUARDED, "--", "true"]);
  assert.equal(elsewhere.code, 2);
  assert.ok(
    elsewhere.stderr.includes(`left ${realpathSync(file)}'s original at ${kept}`),
    elsewhere.stderr,
  );
  assert.equal(s.read("other.txt"), "x\n");
  copyFileSync(kept, file);
  // A leftover copy of a file that is intact again is not an original to protect: a run on any
  // file removes it.
  copyFileSync(file, kept);
  const tidied = s.run("mutate", [
    "other.txt",
    "x",
    "y",
    GUARDED,
    "--",
    ...tested("grep", "-q", "x", "other.txt"),
  ]);
  assert.equal(tidied.code, 0, tidied.stderr);
  const namedBy = kept.replace(/\.orig$/, ".path");
  assert.deepEqual([existsSync(kept), existsSync(namedBy)], [false, false]);
  // A copy that names no file: the run's own is its target's, and is tidied; another's is refused.
  copyFileSync(file, kept);
  const ownUnnamed = s.run("mutate", [
    "guard.txt",
    "x < 0",
    "x < 9",
    GUARDED,
    "--",
    ...tested("grep", "-q", "x < 0", "guard.txt"),
  ]);
  assert.deepEqual([ownUnnamed.code, existsSync(kept)], [0, false], ownUnnamed.stderr);
  copyFileSync(file, kept);
  const unnamed = s.run("mutate", ["other.txt", "x", "y", GUARDED, "--", "true"]);
  assert.equal(unnamed.code, 2);
  assert.ok(
    unnamed.stderr.includes(`left an original at ${kept} without naming its file`),
    unnamed.stderr,
  );
  rmSync(kept);
  // A name ending in a line break is read whole, not as its neighbour that matches the copy.
  const state = path.join(s.work, ".git/ship-mutate");
  const odd = `${realpathSync(s.work)}/n\n`;
  writeFileSync(odd, "MUTANT\n");
  s.write("n", "original\n");
  writeFileSync(path.join(state, "0000000000000001.orig"), "original\n");
  writeFileSync(path.join(state, "0000000000000001.path"), `${odd}\n`);
  const newline = s.run("mutate", ["other.txt", "x", "y", GUARDED, "--", "true"]);
  assert.equal(newline.code, 2, newline.stderr);
  assert.equal(existsSync(path.join(state, "0000000000000001.orig")), true);
  rmSync(path.join(state, "0000000000000001.orig"));
  // A copy and a file that cannot be read are not taken for a match - for anyone but root, whom a
  // mode does not stop.
  if (process.getuid?.() !== 0) {
    writeFileSync(path.join(state, "0000000000000002.orig"), "x\n");
    writeFileSync(path.join(state, "0000000000000002.path"), `${odd}\n`);
    chmodSync(odd, 0o000);
    chmodSync(path.join(state, "0000000000000002.orig"), 0o000);
    const unreadable = s.run("mutate", ["other.txt", "x", "y", GUARDED, "--", "true"]);
    chmodSync(odd, 0o644);
    chmodSync(path.join(state, "0000000000000002.orig"), 0o644);
    assert.equal(unreadable.code, 2, unreadable.stderr);
    assert.equal(existsSync(path.join(state, "0000000000000002.orig")), true);
    rmSync(path.join(state, "0000000000000002.orig"));
  }

  // A process the command leaves running does not keep the next run out.
  const lingering = s.run("mutate", [
    "guard.txt",
    "x < 0",
    "x < 3",
    GUARDED,
    "--",
    "sh",
    "-c",
    "(sleep 3 &); exit 0",
  ]);
  assert.equal(lingering.code, 1, lingering.stderr);
  const next = s.run("mutate", ["guard.txt", "x < 0", "x < 4", GUARDED, "--", "true"]);
  assert.equal(next.code, 1, next.stderr);
});
