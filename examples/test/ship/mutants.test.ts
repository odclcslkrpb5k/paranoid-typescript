/**
 * mutants (TS-5): mutate keeps each mutant whole, so it can be run again; a survivor is due until
 * judged equivalent by a guard, and an equivalence holds only for the files it was judged on: once
 * the mutated file or a guard's file changes the mutant is due again, and is run again from its
 * record. A survivor whose text has left its file, or a record that is not whole, is due until
 * retired by saying what became of it, unless the survivor was judged equivalent.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { type Out, Scratch, SHIP } from "./scratch.ts";
import { sha256 } from "../../tools/ship/check-secret-hashes.ts";
import "../support/leaks.ts";

/** The name of the one test `tested` runs: the reason its failure is named by. */
const GUARDED = "the guard holds";

/** `command` run as a test: on failure it reports one failing test as node:test does. */
function tested(...command: string[]): string[] {
  return [
    "sh",
    "-c",
    `"$@" || { echo "✖ ${GUARDED}"; echo "ℹ fail 1"; exit 1; }`,
    "sh",
    ...command,
  ];
}

/** The id mutate printed for the mutant it recorded. */
function idOf(out: Out): string {
  const id = /recorded as ([0-9a-f]{16});/.exec(out.stdout)?.[1];
  assert.ok(id !== undefined, `no id in: ${out.stdout}${out.stderr}`);
  return id;
}

/** The listing's rows as [id, state]; its exit status beside them. */
function listed(s: Scratch): [number | null, string[][]] {
  const out = s.run("mutants");
  const rows = out.stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.split("\t").slice(0, 2));
  return [out.code, rows];
}

test("mutate keeps the whole mutant, and the same mutant run again keeps one record", (t) => {
  const s = Scratch.create(t);
  s.write("guard.txt", "a\n\nb\n");
  // A find and a replacement ending in line breaks, which a careless record would lose.
  const args = [
    "guard.txt",
    "a\n\n",
    "a\n",
    GUARDED,
    "--",
    ...tested("grep", "-c", "^$", "guard.txt"),
  ];
  const first = s.run("mutate", args);
  assert.equal(first.code, 0, first.stderr);
  const id = idOf(first);
  const record = path.join(s.work, ".git/ship-mutants", id);
  const read = (name: string): string => readFileSync(path.join(record, name), "utf8");
  assert.deepEqual(
    [read("cwd"), read("file"), read("find"), read("replace"), read("reason")],
    [s.work, "guard.txt", "a\n\n", "a\n", GUARDED],
  );
  assert.deepEqual(read("command").split("\0").slice(0, 3), ["sh", "-c", tested()[2]]);
  const again = s.run("mutate", args);
  assert.equal(idOf(again), id);
  assert.deepEqual(readdirSync(path.join(s.work, ".git/ship-mutants")), [id]);
  const verdicts = read("verdicts").trimEnd().split("\n");
  assert.deepEqual(
    verdicts.map((line) => line.split("\t")[1]),
    ["killed", "killed"],
  );
  // Each verdict names the file it judged by its hash.
  const hash = sha256(s.read("guard.txt"));
  assert.ok(
    verdicts.every((line) => line.endsWith(`\t${hash}`)),
    verdicts.join("\n"),
  );
  assert.deepEqual(listed(s), [0, [[id, "killed"]]]);
  // Run again from its record, the line breaks kept: without them it would change nothing.
  const rerun = s.run("mutants", ["again", id]);
  assert.equal(rerun.code, 0, rerun.stderr);
  assert.equal(read("verdicts").trimEnd().split("\n").length, 3);
});

test("a survivor is due until judged equivalent, and due again once its file changes", (t) => {
  const s = Scratch.create(t);
  s.write("guard.txt", "if (x < 0) throw new Error();\n");
  const check = tested("grep", "-q", "x < 0", "guard.txt");
  const survived = s.run("mutate", [
    "guard.txt",
    "throw new Error();",
    "return;",
    GUARDED,
    "--",
    ...check,
  ]);
  assert.equal(survived.code, 1, survived.stderr);
  const id = idOf(survived);
  assert.deepEqual(listed(s), [1, [[id, "OPEN"]]]);

  const judged = s.run("mutants", ["equivalent", id, "the caller never passes x < 0"]);
  assert.equal(judged.code, 0, judged.stderr);
  assert.deepEqual(listed(s), [0, [[id, "equivalent (the caller never passes x < 0)"]]]);

  // The code it was judged on changed: the equivalence no longer holds, and cannot be renewed
  // without running the mutant on the code as it is.
  s.write("guard.txt", "if (x < 0) throw new Error();\nif (x > 9) throw new Error();\n");
  assert.deepEqual(listed(s), [1, [[id, "STALE"]]]);
  const unrun = s.run("mutants", ["equivalent", id, "still"]);
  assert.equal(unrun.code, 2);
  assert.match(unrun.stderr, /has changed since mutant [0-9a-f]+ last ran/);

  // Run again from its record, it survives the new code too, and is judged again.
  const again = s.run("mutants", ["again", id]);
  assert.equal(again.code, 1, again.stderr);
  assert.equal(idOf(again), id);
  assert.deepEqual(listed(s), [1, [[id, "STALE"]]]);
  assert.equal(s.run("mutants", ["equivalent", id, "still"]).code, 0);
  assert.deepEqual(listed(s), [0, [[id, "equivalent (still)"]]]);

  // A guard in another file: a change there makes it due too. A guard of two lines is one.
  s.write("caller.txt", "check(x >= 0);\n");
  const named = s.run("mutants", ["equivalent", id, "the caller\nchecks", "caller.txt"]);
  assert.equal(named.code, 0, named.stderr);
  assert.deepEqual(listed(s), [0, [[id, "equivalent (the caller checks)"]]]);
  s.write("caller.txt", "check(true);\n");
  assert.deepEqual(listed(s), [1, [[id, "STALE"]]]);
  const missing = s.run("mutants", ["equivalent", id, "a guard", "nowhere.txt"]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /no file nowhere\.txt/);
});

test("a survivor whose text has left its file, or a record not whole, is due until retired", (t) => {
  const s = Scratch.create(t);
  s.write("guard.txt", "if (x < 0) throw new Error();\n");
  const id = idOf(
    s.run("mutate", [
      "guard.txt",
      "throw new Error();",
      "return;",
      GUARDED,
      "--",
      ...tested("grep", "-q", "x < 0", "guard.txt"),
    ]),
  );
  const retire = (why: string): Out => s.run("mutants", ["retire", id, why]);
  // Never judged, it stays due when its line is rewritten, until someone says why it may go.
  assert.match(retire("reformatted").stderr, /is OPEN: only a GONE survivor/);
  s.write("guard.txt", "if (x < 0) return;\n");
  assert.deepEqual(listed(s), [1, [[id, "GONE"]]]);
  assert.equal(retire("the check returns now").code, 0);
  assert.deepEqual(listed(s), [0, [[id, "retired (the check returns now)"]]]);
  // Text that comes back is judged again, and a new run ends the retirement: gone again, it is due.
  s.write("guard.txt", "if (x < 0) throw new Error();\n");
  assert.deepEqual(listed(s), [1, [[id, "OPEN"]]]);
  assert.equal(s.run("mutants", ["again", id]).code, 1);
  s.write("guard.txt", "if (x < 0) return;\n");
  assert.deepEqual(listed(s), [1, [[id, "GONE"]]]);
  s.write("guard.txt", "if (x < 0) throw new Error();\n");
  // Judged equivalent, its text going is not due: it was answered for the code that went.
  assert.equal(s.run("mutants", ["equivalent", id, "never negative"]).code, 0);
  rmSync(path.join(s.work, "guard.txt"));
  assert.deepEqual(listed(s), [0, [[id, "GONE"]]]);

  const record = path.join(s.work, ".git/ship-mutants", id);
  // An equivalence that names no hash of its own file holds nothing.
  s.write("guard.txt", "if (x < 0) throw new Error();\n");
  writeFileSync(path.join(record, "equivalent"), "never negative\n");
  assert.deepEqual(listed(s), [1, [[id, "STALE"]]]);
  // Nor one that names only another file, however well that file still matches.
  s.write("caller.txt", "check(x >= 0);\n");
  const caller = sha256(s.read("caller.txt"));
  writeFileSync(path.join(record, "equivalent"), `never negative\n${caller}\tcaller.txt\n`);
  assert.deepEqual(listed(s), [1, [[id, "STALE"]]]);
  writeFileSync(path.join(record, "verdicts"), "");
  assert.deepEqual(listed(s), [1, [[id, "UNREADABLE"]]]);
  writeFileSync(path.join(record, "verdicts"), "2026-10-27T00:00:00Z\tSURVIVED\tx\n");
  rmSync(path.join(record, "cwd"));
  assert.deepEqual(listed(s), [1, [[id, "UNREADABLE"]]]);
  const again = s.run("mutants", ["again", id]);
  assert.equal(again.code, 2);
  assert.match(again.stderr, /is not whole/);
  assert.equal(retire("cut short by a crash").code, 0);
  assert.deepEqual(listed(s), [0, [[id, "retired (cut short by a crash)"]]]);
});

test("a mutant runs again from where it ran, each mutant of a file is its own record, and nothing lists while a mutant is in a file", (t) => {
  const s = Scratch.create(t);
  s.write("sub/guard.txt", "if (x < 0) throw new Error();\n");
  const mutate = (find: string, replace: string): Out =>
    s.exec(
      path.join(s.work, SHIP, "mutate"),
      ["guard.txt", find, replace, GUARDED, "--", ...tested("grep", "-q", "x < 0", "guard.txt")],
      { cwd: path.join(s.work, "sub") },
    );
  const first = idOf(mutate("x < 0", "false"));
  const second = idOf(mutate("x < 0", "true"));
  assert.notEqual(first, second);
  // Run from the top, it runs where it was recorded, where its relative names hold.
  const again = s.run("mutants", ["again", first]);
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /killed/);

  // While a mutant is in a file, nothing reads the records.
  const lock = path.join(s.work, ".git/ship-mutate/lock");
  const held = s.exec("flock", ["-x", lock, path.join(s.work, SHIP, "mutants")]);
  assert.equal(held.code, 2);
  assert.match(held.stderr, /a mutate run is under way/);
});

test("a verdict stands when its record cannot be written", (t) => {
  const s = Scratch.create(t);
  s.write("guard.txt", "if (x < 0) throw new Error();\n");
  writeFileSync(path.join(s.work, ".git/ship-mutants"), "not a directory\n");
  const out = s.run("mutate", [
    "guard.txt",
    "x < 0",
    "false",
    GUARDED,
    "--",
    ...tested("grep", "-q", "x < 0", "guard.txt"),
  ]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(
    out.stdout,
    /^mutate: killed: guard\.txt: x < 0\nmutate: the mutant could not be recorded\n$/,
  );
  assert.equal(s.read("guard.txt"), "if (x < 0) throw new Error();\n");
});

test("only a survivor is judged equivalent, and only a recorded mutant by a guard named", (t) => {
  const s = Scratch.create(t);
  s.write("guard.txt", "if (x < 0) throw new Error();\n");
  const killed = s.run("mutate", [
    "guard.txt",
    "x < 0",
    "false",
    GUARDED,
    "--",
    ...tested("grep", "-q", "x < 0", "guard.txt"),
  ]);
  assert.equal(killed.code, 0, killed.stderr);
  const id = idOf(killed);
  for (const [args, said] of [
    [["equivalent", id, "a guard"], /did not survive/],
    [["equivalent", id, " "], /usage/],
    [["equivalent", "0123456789abcdef", "a guard"], /no mutant/],
    [["again", "../../etc"], /no mutant/],
    [["again", `../ship-mutants/${id}`], /no mutant/],
    [["list"], /usage/],
  ] as const) {
    const out = s.run("mutants", [...args]);
    assert.equal(out.code, 2, `${args.join(" ")}: ${out.stdout}`);
    assert.match(out.stderr, said);
  }
  assert.deepEqual(listed(s), [0, [[id, "killed"]]]);
});
