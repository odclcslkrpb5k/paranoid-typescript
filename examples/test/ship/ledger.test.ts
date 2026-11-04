/**
 * The ledger timed and commit-and-push keep in .git/, and the SH-9 decision close-ship records in
 * it: a ship's report waits on that decision, each row is one step as it ran, and nothing a step's
 * label, command or path holds can forge a row.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { DOCKER_STEP, Scratch, SHIP } from "./scratch.ts";
import "../support/leaks.ts";
import { must } from "../support/assert.ts";

const OK = "#!/bin/sh\nexit 0\n";

test("a ship's report waits on its SH-9 decision, and each ship needs its own", (t) => {
  const s = Scratch.create(t);
  const report = () => s.run("timed", ["--report"]);
  // Nothing shipped yet: nothing to decide, and the report prints.
  assert.equal(report().code, 0);
  const early = s.run("close-ship", ["--nothing"]);
  assert.equal(early.code, 2);
  assert.match(early.stderr, /nothing has shipped/);

  s.write("main.ts", "two\n");
  assert.equal(s.ship(s.checked()).code, 0);
  const sha = s.git(s.work, "rev-parse", "--short", "HEAD");
  const refused = report();
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /no SH-9 decision/);
  assert.match(refused.stderr, /sent to the standard's maintainers/);
  assert.equal(refused.stdout, "", "no part of the report before the decision");
  // Nor can the next ship's preflight erase the debt by starting a fresh ledger.
  const restart = s.run("timed", ["--start"]);
  assert.equal(restart.code, 2);
  assert.match(restart.stderr, /no SH-9 decision yet/);
  // Run again for the same commit, it finds origin holding it, and records it once, not twice.
  assert.equal(s.ship(s.hash()).code, 0);
  assert.equal(s.ledger().filter((row) => row[0] === "shipped").length, 1);

  // A --sent with nothing said is no decision, and neither is an unknown mode.
  for (const args of [["--sent", "  "], ["--sent"], ["--asked", "x"], ["--nothing", "x"]]) {
    assert.equal(s.run("close-ship", args).code, 2, args.join(" "));
  }
  const decided = s.run("close-ship", ["--nothing"]);
  assert.equal(decided.stdout.trim(), `close-ship: SH-9 for ${sha}: nothing for the standard`);
  const printed = report();
  assert.equal(printed.code, 0, printed.stderr);
  assert.match(printed.stdout, /TOTAL/);

  // The next ship reopens it, and a sent decision closes it with what was sent.
  s.write("main.ts", "three\n");
  assert.equal(s.ship(s.checked()).code, 0);
  assert.equal(report().code, 2);
  // What was sent can hold a tab or a newline; the row keeps its five fields regardless, so it
  // cannot pass for a step's.
  s.run("close-ship", ["--sent", "SH-12: a GUID\tanywhere\ngate\t0\tforged"]);
  assert.equal(report().code, 0);
  const decision = s.ledger().at(-1) ?? [];
  assert.deepEqual([decision.length, decision[0]], [5, "standard"]);
  assert.match(decision[4] ?? "", /^sent to the standard: SH-12: a GUID anywhere gate 0 forged \(/);
  // Decided, the next ship's preflight may start a fresh ledger again.
  assert.equal(s.run("timed", ["--start"]).code, 0);

  // The ledger's own labels cannot be borrowed by a step.
  const borrowed = s.run("timed", ["standard", "true"]);
  assert.equal(borrowed.code, 2);
  assert.match(borrowed.stderr, /the ledger's own label/);
});

test("two ships with no fresh start between them are decided together, by name", (t) => {
  const s = Scratch.create(t);
  const shas: string[] = [];
  for (const text of ["two\n", "three\n"]) {
    s.write("main.ts", text);
    assert.equal(s.ship(s.checked()).code, 0);
    shas.push(s.git(s.work, "rev-parse", "--short", "HEAD"));
  }
  const decided = s.run("close-ship", ["--nothing"]);
  assert.equal(
    decided.stdout.trim(),
    `close-ship: SH-9 for ${shas.join(" ")}: nothing for the standard`,
  );
  // Nothing has shipped since: no decision is owed, so none can be recorded.
  const again = s.run("close-ship", ["--nothing"]);
  assert.equal(again.code, 2);
  assert.match(again.stderr, /nothing has shipped since the last decision/);
});

test("a shipped row with no commit still owes, and gets, its decision", (t) => {
  const s = Scratch.create(t);
  appendFileSync(path.join(s.work, ".git/ship-timings.ledger"), "shipped\t0\t-\t-\t\n");
  assert.equal(s.run("timed", ["--report"]).code, 2);
  const decided = s.run("close-ship", ["--nothing"]);
  assert.equal(decided.code, 0, decided.stderr);
  assert.match(decided.stdout, /SH-9 for \(unnamed\)/);
  assert.equal(s.run("timed", ["--report"]).code, 0);
});

test("a step's label or command cannot write a ledger row of its own", (t) => {
  const s = Scratch.create(t);
  const ledger = path.join(s.work, ".git/ship-timings.ledger");
  const before = readFileSync(ledger, "utf8");
  for (const args of [
    ["standard\tx", "true"],
    ["ok", "bash", "-c", "true\nstandard"],
    ["ok\r", "true"],
  ]) {
    const out = s.run("timed", args);
    assert.equal(out.code, 2, JSON.stringify(args));
    assert.match(out.stderr, /could forge a ledger row/);
  }
  // Nor through the path the command is recorded as: made absolute, it takes in the names of the
  // directories above the script, and one of those can hold a line break.
  const dir = path.join(s.work, "sub\nstandard\t0\t-\t-\tforged");
  mkdirSync(dir);
  writeFileSync(path.join(dir, "ok"), OK, { mode: 0o755 });
  // Run as ./ok from inside it, the arguments hold no line break; only the recorded path does.
  const timed = path.join(s.work, SHIP, "timed");
  const forged = s.exec(timed, ["ok", "./ok"], { cwd: dir });
  assert.equal(forged.code, 2, forged.stderr);
  assert.match(forged.stderr, /could forge a ledger row/);
  // A trailing line break, which `$(...)` strips from the recorded path: a script named `ok` plus a
  // line break would be recorded as `ok`, and so would one run from a directory whose name ends so.
  writeFileSync(path.join(s.work, "ok\n"), OK, { mode: 0o755 });
  assert.equal(s.run("timed", ["ok", path.join(s.work, "ok\n")]).code, 2);
  const end = path.join(s.work, "end\n");
  mkdirSync(end);
  writeFileSync(path.join(end, "ok"), OK, { mode: 0o755 });
  assert.equal(s.exec(timed, ["ok", "./ok"], { cwd: end }).code, 2);
  assert.equal(readFileSync(ledger, "utf8"), before);
});

test("a step is recorded as the file the kernel ran, and run as that file", (t) => {
  const s = Scratch.create(t);
  const last = (): string[] => s.ledger().at(-1) ?? [];
  // link/.. is the work tree as text, but the kernel follows the link: the real gate's path would
  // be recorded for a gate elsewhere.
  const deep = path.join(s.dir, "elsewhere/deep");
  const decoy = path.join(s.dir, "elsewhere", SHIP);
  mkdirSync(deep, { recursive: true });
  mkdirSync(decoy, { recursive: true });
  writeFileSync(path.join(decoy, "gate"), OK, { mode: 0o755 });
  symlinkSync(deep, path.join(s.work, "link"));
  const linked = s.run("timed", ["gate", `link/../${SHIP}/gate`]);
  assert.equal(linked.code, 0, linked.stderr);
  assert.equal(last()[4], `${realpathSync(decoy)}/gate`);

  // A relative directory named "-" is that directory, not the previous one. (Whether the step
  // passes is beside the point: /bin/sh reads the path it is handed, "-/ok", as an option.)
  mkdirSync(path.join(s.work, "-"));
  writeFileSync(path.join(s.work, "-/ok"), OK, { mode: 0o755 });
  s.run("timed", ["ok", "-/ok"]);
  assert.equal(last()[4], `${realpathSync(s.work)}/-/ok`);

  // Nothing from the environment runs in the command's place: an exported function named like it,
  // one named `command`, or one a BASH_ENV file defines. The fake docker fails the step; any of
  // them would have passed, as it does in a shell that lets it (the control).
  writeFileSync(path.join(s.dir, "env.sh"), "command() { return 0; }\ndocker() { return 0; }\n");
  const control = s.exec("bash", ["-c", '"$@"', "bash", ...DOCKER_STEP], {
    extra: { "BASH_FUNC_docker%%": "() {  return 0; }", FAIL: "check" },
  });
  assert.equal(control.code, 0, "a function named like the step does shadow it in a plain shell");
  for (const env of [
    { "BASH_FUNC_docker%%": "() {  return 0; }" },
    { "BASH_FUNC_command%%": "() {  return 0; }" },
    { BASH_ENV: path.join(s.dir, "env.sh") },
  ]) {
    const shadowed = s.run("timed", ["test", ...DOCKER_STEP], { FAIL: "check", ...env });
    assert.equal(shadowed.code, 1, JSON.stringify(env));
    assert.deepEqual(last().slice(0, 2), ["test", "1"]);
  }
  // Run as `bash timed`, without the shebang's -p, a function named like the step still does not
  // run in its place (one named `command` would: -p is what stops that).
  writeFileSync(path.join(s.dir, "docker-only.sh"), "docker() { return 0; }\n");
  const unprivileged = s.exec("bash", [path.join(s.work, SHIP, "timed"), "test", ...DOCKER_STEP], {
    extra: { BASH_ENV: path.join(s.dir, "docker-only.sh"), FAIL: "check" },
  });
  assert.equal(unprivileged.code, 1, unprivileged.stderr);

  // A path directly under the root is recorded from the root, not from where timed was run.
  s.run("timed", ["ok", "/tmp"]);
  assert.equal(last()[4], "//tmp");

  // A git whose write-tree prints more than a tree id writes no row of its own: the step refuses.
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  mkdirSync(path.join(s.dir, "fake-git"));
  writeFileSync(
    path.join(s.dir, "fake-git/git"),
    `#!/bin/sh\nif [ "$1" = write-tree ]; then printf '%040d\\nstandard\\t0\\t-\\t-\\tforged\\n' 0; ` +
      `exit 0; fi\nexec ${realGit} "$@"\n`,
    { mode: 0o755 },
  );
  const rows = s.ledger().length;
  const forged = s.run("timed", ["ok", "true"], {
    PATH: `${path.join(s.dir, "fake-git")}:${s.env()["PATH"] ?? ""}`,
  });
  assert.equal(forged.code, 2);
  assert.match(forged.stderr, /the tree could not be hashed/);
  assert.equal(s.ledger().length, rows);
});

test("a timed step with no command, or a usage error, is refused and recorded nowhere", (t) => {
  const s = Scratch.create(t);
  for (const args of [[], ["label-only"]]) {
    const out = s.run("timed", args);
    assert.equal(out.code, 2, args.join(" "));
    assert.match(out.stderr, /usage: timed/);
  }
  assert.deepEqual(s.ledger(), []);
});

test("each step says the host's load and cores as it ended, and the total counts every step", (t) => {
  const s = Scratch.create(t);
  assert.equal(s.run("timed", ["--start"]).code, 0);
  assert.equal(s.run("timed", ["passes", "true"]).code, 0);
  // A label with digits and an "s" of its own counts its step's seconds, not its own.
  assert.equal(s.run("timed", ["fails 90s", "sh", "-c", "sleep 1; exit 3"]).code, 3);
  const printed = s.run("timed", ["--report"]);
  assert.equal(printed.code, 0, printed.stderr);
  const lines = printed.stdout.trim().split("\n");
  // SH-7: a timing gate's result is read beside the load it ran under.
  const seconds = (line: string | undefined, label: string): number => {
    const found = new RegExp(`^${label} +(\\d+)s {2}load [0-9.]+ of \\d+ cores`).exec(line ?? "");
    return Number.parseInt(must(found?.[1], `${label}'s seconds`), 10);
  };
  const passed = seconds(lines[0], "passes");
  const failed = seconds(lines[1], "fails 90s");
  assert.match(lines[1] ?? "", / {2}\(exit 3\)$/);
  assert.ok(failed >= 1, "the failed step took its second");
  // The total is every step's seconds, the failed one's included; never the label's, nor the load.
  assert.equal(lines[2], `TOTAL${" ".repeat(24)}${String(passed + failed).padStart(4)}s`);
});

test("a step that exits 0 while its runner reports a failing test is recorded as failed (SH-11)", (t) => {
  const s = Scratch.create(t);
  const step = (text: string, exit = 0) =>
    s.run("timed", ["step", "sh", "-c", `printf '%b\\n' "$1"; exit ${String(exit)}`, "sh", text]);
  // node:test's counts (spec and TAP), its heading for failures, and Playwright's count, with a
  // terminal's colour and carriage return as a run in one prints them.
  for (const text of [
    "ℹ fail 1",
    "# fail 12",
    "ℹ cancelled 1",
    "✖ failing tests:",
    "  2 failed",
    "\u001b[31m  1 failed\u001b[39m",
    // A carriage return, as an escape: timed refuses one in a command's words.
    "ℹ fail 1\\r",
    "not ok 2 - /repo/after.test.mjs",
    // A test whose own name holds "# skip", escaped by node:test, is not marked skipped.
    "not ok 1 - x \\\\# skip me",
  ]) {
    const out = step(text);
    assert.equal(out.code, 1, JSON.stringify(text));
    assert.match(out.stderr, /exited 0, but its output reports a failing test/);
    assert.equal(s.ledger().at(-1)?.[1], "1", "the ledger records the failure");
  }
  // None is a failure: counts of 0, a count in a test's own output or not as its runner writes
  // it, a subtest's `not ok`, a skipped or pending test, and retried tests.
  for (const text of [
    "ℹ fail 0",
    "ℹ cancelled 0",
    "  ℹ fail 1",
    "ℹ fail 1x",
    "  1 flaky",
    "  0 failed",
    "1 failed",
    "  not ok 1 - a subtest",
    "not ok 3 - pending # TODO",
    "not ok 4 - not here # SKIP",
  ]) {
    const out = step(text);
    assert.equal(out.code, 0, JSON.stringify(text));
    assert.equal(out.stdout, `${text}\n`, "the output still reaches the terminal");
  }
  // A command that failed keeps its own status.
  assert.equal(step("ℹ fail 1", 3).code, 3);
  // What timed kept of the output is gone once it ends.
  const kept = readdirSync(path.join(s.work, ".git")).filter((name) =>
    name.startsWith("ship-timed"),
  );
  assert.deepEqual(kept, []);
});

test("node:test exiting 0 after a top-level after hook threw is a failed step, in either reporter", (t) => {
  const s = Scratch.create(t);
  const file = path.join(s.dir, "after.test.mjs");
  writeFileSync(
    file,
    'import { after, test } from "node:test";\n' +
      'test("passes", () => {});\n' +
      'after(() => { throw new Error("teardown found a leak"); });\n',
  );
  for (const reporter of ["spec", "tap"]) {
    const args = ["--test", "--test-isolation=none", `--test-reporter=${reporter}`, file];
    // The premise: the runner itself says it passed.
    // Run as timed runs it: outside this runner, which would make a nested one report to it.
    const direct = spawnSync(process.execPath, args, { encoding: "utf8", env: s.env() });
    assert.equal(direct.status, 0, `${reporter}: node:test exits 0 here`);
    const out = s.run("timed", ["after-hook", process.execPath, ...args]);
    assert.equal(out.code, 1, `${reporter}: ${out.stdout}`);
    assert.equal(s.ledger().at(-1)?.[1], "1");
  }
});
