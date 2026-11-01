/**
 * commit-and-push and the tree hash it relies on (SH-10, SH-11): a commit and a push happen only for
 * the tree that the gate, the full suite and every step the changed paths call for passed against
 * from start to finish - not a tree edited during a run, not one edited after it, and not an older
 * one whose hash was passed by mistake.
 */
import assert from "node:assert/strict";
import { chmodSync, symlinkSync, utimesSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  copyScripts,
  heldLocally,
  HOOKS,
  LEAK,
  nothingShipped,
  Scratch,
  SHIP,
  SUITE,
} from "./scratch.ts";
import { sha256 } from "../../tools/ship/check-secret-hashes.ts";
import "../support/leaks.ts";

test("the tree hash is what `git add -A` would commit, and reading it changes nothing", (t) => {
  const s = Scratch.create(t);
  const clean = s.hash();
  s.write("ignored.txt", "ignored\n");
  assert.equal(s.hash(), clean, "an ignored file is not part of a commit");
  s.write("new.ts", "untracked\n");
  const added = s.hash();
  assert.notEqual(added, clean, "an untracked file is");
  // The real index is untouched, so the file is still untracked.
  assert.equal(s.git(s.work, "status", "--short"), "?? new.ts");
  // And the diff the reviewers read carries it too.
  assert.match(s.run("ship-diff").stdout, /\+untracked/);
  s.git(s.work, "add", "-A");
  assert.equal(s.git(s.work, "write-tree"), added);
});

test("the tree hash reads content, not the stat data a same-size edit leaves unchanged", (t) => {
  const s = Scratch.create(t);
  // A clone that does not trust ctime, as some do, compares only size and mtime.
  s.git(s.work, "config", "core.trustctime", "false");
  // The file's time well in the past and the index refreshed after it, so git records the entry
  // as clean and trusts it from then on.
  const past = new Date(Date.now() - 60_000);
  utimesSync(path.join(s.work, "main.ts"), past, past);
  s.git(s.work, "update-index", "--refresh");
  const clean = s.hash();
  // Same size, and the time put back: to anything trusting cached stat data, nothing changed.
  s.write("main.ts", "two\n");
  utimesSync(path.join(s.work, "main.ts"), past, past);
  assert.notEqual(s.hash(), clean, "the edit is in the hash");
  assert.match(s.run("ship-diff").stdout, /\+two/);
});

test("the commit stages content, not the stat data a same-size edit leaves unchanged", (t) => {
  const s = Scratch.create(t);
  s.git(s.work, "config", "core.trustctime", "false");
  const past = new Date(Date.now() - 60_000);
  utimesSync(path.join(s.work, "main.ts"), past, past);
  s.git(s.work, "update-index", "--refresh");
  // The real index holds main.ts as clean; the edit keeps its size and its time.
  s.write("main.ts", "two\n");
  utimesSync(path.join(s.work, "main.ts"), past, past);
  const out = s.ship(s.checked());
  assert.equal(out.code, 0, out.stderr);
  assert.equal(s.git(s.origin, "show", "main:main.ts"), "two");
});

test("a commit whose index cannot be staged says so, and pushes nothing", (t) => {
  const s = Scratch.create(t);
  s.write("main.ts", "two\n");
  const tree = s.checked();
  // Another git process holding the index, as an editor's background status can.
  s.write(".git/index.lock", "");
  nothingShipped(s, s.ship(tree), "the index could not be staged from HEAD");
});

test("timed records the tree at both ends of a step, the command, and a change under it", (t) => {
  const s = Scratch.create(t);
  const before = s.hash();
  const steady = s.gate();
  assert.match(steady.stderr, new RegExp(`timed: tree ${before}`));

  const edits = s.full({ DURING: "echo two > main.ts", FAIL: "check" });
  assert.equal(edits.code, 1, "the step's own status comes back");
  assert.match(edits.stderr, /STALE: the tree changed while this ran/);
  // The gate's path recorded absolute, typed relative: what ran, wherever it was typed.
  assert.deepEqual(s.ledger(), [
    ["gate", "0", before, before, path.join(s.work, SHIP, "gate")],
    ["test", "1", before, s.hash(), SUITE.join(" ")],
  ]);
});

test("a tree that passed from start to finish is committed and pushed, and nothing else", (t) => {
  const s = Scratch.create(t);
  s.write("main.ts", "two\n");
  s.write("new.ts", "untracked\n");
  const tree = s.checked();
  const out = s.ship(tree);
  assert.equal(out.code, 0, out.stderr);
  assert.deepEqual(
    [s.log(), s.log(s.origin)],
    [
      ["Ship it", "first"],
      ["Ship it", "first"],
    ],
  );
  assert.equal(s.git(s.work, "rev-parse", "HEAD^{tree}"), tree);
});

test("--reviewed shows what changed after the review, and only that", (t) => {
  const s = Scratch.create(t);
  s.write("main.ts", "reviewed\n");
  const reviewed = s.hash();
  s.write("fix.ts", "after the review\n");
  const tree = s.checked();
  const out = s.ship(tree, "--reviewed", reviewed);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, /fix\.ts/);
  assert.ok(!out.stdout.includes("main.ts"), "a file unchanged since the review is not listed");
  assert.deepEqual(s.log(s.origin), ["Ship it", "first"]);
  // A review tree that is not a tree id, or not one this repository has, is refused.
  const bad = s.run("commit-and-push", [tree, s.message, "--reviewed", "nonsense"]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /nonsense is not a tree id/);
});

test("an edit after the checks, or a hash from an earlier tree, ships nothing", (t) => {
  const s = Scratch.create(t);
  s.write("main.ts", "two\n");
  const tree = s.checked();
  s.write("main.ts", "edited after the tests\n");
  nothingShipped(s, s.ship(tree), "the tree is");
  // The new tree checked too, but the earlier hash passed by mistake: both passed, one is here.
  const now = s.checked();
  assert.notEqual(now, tree);
  nothingShipped(s, s.ship(tree), "did not pass against");
});

test("only the latest run of each step counts, and only as the command it names", (t) => {
  // A gate that fails: its comment checker cannot start.
  const failingGate = { SHIP_NODE: "/bin/false" };
  const cases: [string, string, (s: Scratch) => void][] = [
    [
      "failed",
      "test",
      (s) => {
        s.gate();
        s.full({ FAIL: "check" });
      },
    ],
    [
      "stale",
      "test",
      (s) => {
        // It ends on the tree it changed; a gate then passes against that tree.
        s.full({ DURING: "echo during > main.ts" });
        s.gate();
      },
    ],
    [
      "edited and put back",
      "test",
      (s) => {
        s.gate();
        s.full({ DURING: "echo during > main.ts" });
        s.write("main.ts", "two\n");
      },
    ],
    [
      "passed, then failed",
      "test",
      (s) => {
        s.gate();
        s.full();
        s.full({ FAIL: "check" });
      },
    ],
    ["never ran", "test", (s) => s.gate()],
    ["no gate", "gate", (s) => s.full()],
    [
      "a gate that failed",
      "gate",
      (s) => {
        assert.equal(s.gate(failingGate).code, 1);
        s.full();
      },
    ],
    [
      "the label on another command",
      "test",
      (s) => {
        s.gate();
        s.run("timed", ["test", ...SUITE.slice(0, -1), "check-db"]);
      },
    ],
    [
      "the command under another label",
      "test",
      (s) => {
        s.gate();
        s.run("timed", ["test, again", ...SUITE]);
      },
    ],
  ];
  for (const [name, step, steps] of cases) {
    const s = Scratch.create(t);
    s.write("main.ts", "two\n");
    steps(s);
    const out = s.ship(s.hash());
    assert.ok(
      out.stderr.includes(`the latest '${step}' step did not pass against`),
      `${name}: ${out.stderr}\n${JSON.stringify(s.ledger())}`,
    );
    nothingShipped(s, out, `'${step}'`);
  }
});

test("a ship whose push failed resumes: no second commit", (t) => {
  const s = Scratch.create(t);
  s.write("main.ts", "two\n");
  const tree = s.checked();
  // The push fails: origin cannot be written.
  chmodSync(path.join(s.origin, "objects"), 0o555);
  const pushless = s.ship(tree);
  chmodSync(path.join(s.origin, "objects"), 0o755);
  // A commit exists, so the refusal says it may be local or on origin, never that nothing happened.
  heldLocally(s, pushless, "the push failed");
  assert.deepEqual(s.log(), ["Ship it", "first"]);

  const done = s.ship(tree);
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /pushing it rather than committing again/);
  assert.deepEqual(
    [s.log(), s.log(s.origin)],
    [
      ["Ship it", "first"],
      ["Ship it", "first"],
    ],
  );
  const again = s.ship(tree);
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /origin\/main already holds/);
  assert.deepEqual(s.log(), ["Ship it", "first"], "one commit, however many tries");
});

test("a hook that changes what was committed is caught before the push", (t) => {
  const s = Scratch.create(t);
  s.write(
    ".githooks/pre-commit",
    "#!/usr/bin/env bash\necho sneaked > sneaked.ts && git add sneaked.ts\n",
    0o755,
  );
  s.write("main.ts", "two\n");
  heldLocally(s, s.ship(s.checked()), "the commit holds");
});

test("a ship from behind origin, off main, or with no origin is refused first", (t) => {
  const s = Scratch.create(t);
  // Someone else's commit lands on origin.
  const other = path.join(s.dir, "other");
  s.git(s.dir, "clone", "-q", s.origin, other);
  s.write("../other/theirs.ts", "theirs\n");
  s.git(other, "add", "-A");
  s.git(other, "commit", "-q", "-m", "theirs");
  s.git(other, "push", "-q", "origin", "main");
  s.write("main.ts", "two\n");
  const behind = s.ship(s.checked());
  assert.equal(behind.code, 1);
  assert.match(behind.stderr, /origin\/main has commits this clone lacks/);
  assert.deepEqual(s.log(), ["first"]);

  const off = Scratch.create(t);
  off.git(off.work, "checkout", "-q", "-b", "elsewhere");
  nothingShipped(off, off.ship(off.checked()), "not on main");

  const lost = Scratch.create(t);
  lost.git(lost.work, "remote", "remove", "origin");
  lost.write("main.ts", "two\n");
  const out = lost.ship(lost.checked());
  assert.equal(out.code, 1);
  assert.match(out.stderr, /this clone has no origin; nothing was committed or pushed/);
  assert.deepEqual(lost.log(), ["first"]);
});

test("a commit is refused unless the pre-commit hook, and its secrets check, is enabled", (t) => {
  const s = Scratch.create(t);
  s.git(s.work, "config", "--unset", "core.hooksPath");
  s.write("main.ts", "two\n");
  nothingShipped(s, s.ship(s.checked()), "core.hooksPath is not .githooks");
});

test("a commit the pre-commit hook refuses ships nothing, and says so", (t) => {
  const s = Scratch.create(t);
  s.write(".githooks/pre-commit", "#!/usr/bin/env bash\necho refused >&2\nexit 1\n", 0o755);
  s.write("main.ts", "two\n");
  nothingShipped(s, s.ship(s.checked()), "the commit was refused");
});

test("an earlier local commit, never checked, cannot ride along with this ship's", (t) => {
  const s = Scratch.create(t);
  s.write("unchecked.ts", "committed by hand\n");
  s.git(s.work, "add", "-A");
  s.git(s.work, "commit", "-q", "-m", "by hand");
  s.write("main.ts", "two\n");
  const out = s.ship(s.checked());
  assert.equal(out.code, 1);
  assert.match(out.stderr, /HEAD carries commits origin\/main lacks/);
  assert.deepEqual(s.log(s.origin), ["first"]);
});

test("a merge carrying unchecked commits, or a hook that git would skip, ships nothing", (t) => {
  const s = Scratch.create(t);
  s.git(s.work, "checkout", "-q", "-b", "side");
  s.write("side.ts", "unchecked\n");
  s.git(s.work, "add", "-A");
  s.git(s.work, "commit", "-q", "-m", "side");
  s.git(s.work, "checkout", "-q", "main");
  s.git(s.work, "merge", "-q", "--no-ff", "-m", "merge", "side");
  const merged = s.ship(s.checked());
  assert.equal(merged.code, 1);
  assert.match(merged.stderr, /HEAD carries commits origin\/main lacks/);
  assert.deepEqual(s.log(s.origin), ["first"]);

  // A merge whose second parent origin already holds counts one commit ahead, and is still a merge.
  const m = Scratch.create(t);
  m.landOnOrigin("second", { "second.ts": "2\n" });
  m.write("main.ts", "two\n");
  const tree = m.checked();
  const commit = m.git(m.work, "commit-tree", tree, "-p", "HEAD", "-p", "HEAD~1", "-m", "merge");
  m.git(m.work, "update-ref", "refs/heads/main", commit);
  const single = m.ship(tree);
  assert.equal(single.code, 1, single.stderr);
  assert.match(single.stderr, /HEAD carries commits origin\/main lacks/);
  assert.deepEqual(m.log(m.origin), ["second", "first"]);

  const n = Scratch.create(t);
  chmodSync(path.join(n.work, ".githooks/pre-commit"), 0o644);
  n.write("main.ts", "two\n");
  nothingShipped(n, n.ship(n.checked()), "pre-commit is not executable");
});

test("a commit message carrying a credential ships nothing, and the hook refuses it by hand", (t) => {
  // Assembled here, so this file holds no secret-shaped line for the real gate to refuse.
  const leak = `Rotate ${"AKIA" + "ABCDEFGHIJKLMNOP"}\n`;
  const s = Scratch.create(t);
  s.write("../message", leak);
  s.write("main.ts", "two\n");
  nothingShipped(s, s.ship(s.checked()), "the commit message carries what looks like a credential");

  // On a "#" line too: committed with --file, git keeps such a line unless told to strip it, so it
  // is judged like any other.
  const c = Scratch.create(t);
  c.write("../message", `Ship it\n\n# ${leak}`);
  c.write("main.ts", "two\n");
  nothingShipped(c, c.ship(c.checked()), "the commit message carries what looks like a credential");

  // A commit made by hand: the repository's own commit-msg hook judges the message.
  const h = Scratch.create(t);
  copyScripts(HOOKS, path.join(h.work, ".githooks"));
  h.write(".githooks/pre-commit", "#!/usr/bin/env bash\nexit 0\n", 0o755);
  h.write("main.ts", "two\n");
  h.git(h.work, "add", "-A");
  const refused = h.exec("git", ["commit", "-q", "-m", leak]);
  assert.notEqual(refused.code, 0);
  assert.match(refused.stdout + refused.stderr, /AWS access key: 1 added line\(s\)/);
  assert.deepEqual(h.log(), ["first"]);
  // `-m` keeps a "#" line in the commit, so the hook judges it.
  const hashed = h.exec("git", ["commit", "-q", "-m", `Rotate the key\n\n# ${leak}`]);
  assert.notEqual(hashed.code, 0);
  assert.match(hashed.stdout + hashed.stderr, /AWS access key: 1 added line\(s\)/);
  assert.deepEqual(h.log(), ["first"]);
  h.git(h.work, "commit", "-q", "-m", "Rotate the key");
  assert.deepEqual(h.log(), ["Rotate the key", "first"]);

  // A resume pushes HEAD's own message, which a --no-verify commit kept from the hook.
  const r = Scratch.create(t);
  r.write("main.ts", "two\n");
  r.git(r.work, "add", "-A");
  r.git(r.work, "commit", "-q", "--no-verify", "-m", leak);
  const resumed = r.ship(r.checked());
  assert.equal(resumed.code, 1, resumed.stderr);
  assert.match(resumed.stderr, /HEAD's message carries what looks like a credential/);
  assert.deepEqual(r.log(r.origin), ["first"]);
});

test('the message is committed as an editor would leave it: its "#" lines stripped', (t) => {
  const s = Scratch.create(t);
  s.write("../message", "Ship it\n\n# a note to the author\nBecause.\n");
  s.write("main.ts", "two\n");
  const out = s.ship(s.checked());
  assert.equal(out.code, 0, out.stderr);
  assert.equal(s.git(s.origin, "log", "-1", "--format=%B", "main"), "Ship it\n\nBecause.");
});

test("the repository's pre-commit hook refuses a staged secret or a narrating comment", (t) => {
  for (const [file, text, reason] of [
    ["leak.ts", LEAK, /password literal: 1 match/],
    ["note.ts", ["// this ", "fixes the bug\n"].join(""), /CD-1: these comments narrate/],
  ] as const) {
    const s = Scratch.create(t);
    copyScripts(HOOKS, path.join(s.work, ".githooks"));
    s.write(file, text);
    s.git(s.work, "add", "-A");
    const refused = s.exec("git", ["commit", "-q", "-m", "By hand"]);
    assert.notEqual(refused.code, 0, file);
    assert.match(refused.stdout + refused.stderr, reason);
    assert.deepEqual(s.log(), ["first"]);
  }
});

test("a resumed commit that deletes a digest is judged against origin's list", (t) => {
  // The commit being pushed empties the hash list and carries the listed value in its message:
  // judged against origin's list, not HEAD's.
  const value = ["zq7f", "unshaped", "value", "9xk"].join("-");
  const digest = sha256(value);
  const h = Scratch.create(t);
  h.landOnOrigin("list", { "tools/secret-hashes.txt": `${digest}\n` });
  h.write("tools/secret-hashes.txt", "# emptied\n");
  h.git(h.work, "add", "-A");
  h.git(h.work, "commit", "-q", "--no-verify", "-m", `Carry ${value}`);
  const held = h.ship(h.checked());
  assert.equal(held.code, 1, held.stderr);
  assert.match(held.stderr, /HEAD's message carries what looks like a credential/);
  assert.deepEqual(h.log(h.origin), ["list", "first"]);
});

test("commit-and-push run through a symlink to the clone ships; one from another checkout refuses", (t) => {
  const s = Scratch.create(t);
  s.write("main.ts", "two\n");
  const tree = s.checked();
  const run = (script: string) => s.exec(script, [tree, s.message]);
  // Scripts copied outside the clone have no required-steps there for origin's copy to be read as.
  const elsewhere = path.join(s.dir, "elsewhere", SHIP);
  copyScripts(path.join(s.work, SHIP), elsewhere);
  const foreign = run(path.join(elsewhere, "commit-and-push"));
  assert.equal(foreign.code, 1);
  assert.match(
    foreign.stderr,
    /are not in this repository \(.*\); nothing was committed or pushed/,
  );
  // Nor a copy nested inside the clone, whose required-steps would stand in for this one's.
  const nested = path.join(s.work, "sub", SHIP);
  copyScripts(elsewhere, nested);
  const inner = run(path.join(nested, "commit-and-push"));
  assert.equal(inner.code, 1);
  assert.match(inner.stderr, /are not in this repository/);
  s.exec("rm", ["-rf", path.join(s.work, "sub")]);
  assert.deepEqual(s.log(s.origin), ["first"]);
  // A function exported under git's name does not stand in for git.
  const shadowed = s.run("commit-and-push", [tree, s.message], {
    "BASH_FUNC_git%%": "() { return 0; }",
  });
  assert.equal(shadowed.code, 0, shadowed.stderr);
  assert.deepEqual(s.log(s.origin), ["Ship it", "first"]);
  // The clone's own scripts, reached through a link, are the clone's: the pushed commit is found.
  symlinkSync(s.work, path.join(s.dir, "link"));
  const linked = run(path.join(s.dir, "link", SHIP, "commit-and-push"));
  assert.equal(linked.code, 0, linked.stderr);
  assert.deepEqual(s.log(s.origin), ["Ship it", "first"]);
});

test("a usage error is its own status, and a mistyped tree is refused before anything runs", (t) => {
  const s = Scratch.create(t);
  for (const args of [
    [],
    ["only-one"],
    [s.hash(), s.message, "--reviewed"],
    ["a", "b", "c", "d"],
  ]) {
    const out = s.run("commit-and-push", args);
    assert.equal(out.code, 2, args.join(" "));
    assert.match(out.stderr, /usage: commit-and-push/);
  }
  nothingShipped(s, s.ship("not-a-tree"), "not-a-tree is not a tree id");
  nothingShipped(
    s,
    s.run("commit-and-push", [s.hash(), path.join(s.dir, "absent")]),
    "no message file",
  );
});
