/**
 * What Paranoid TypeScript's SH-10 and SH-14 ask of commit-and-push: the first ship from an
 * unborn HEAD, the remote ref named in full, a push that goes where it was meant
 * to, by hash, read back, and the strict bash every ship script runs under. Each guard here has a
 * test that a hook or a hostile configuration would otherwise get past.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { heldLocally, HOOKS, nothingShipped, Scratch, SCRIPTS, SHIP } from "./scratch.ts";
import "../support/leaks.ts";

test("the first ship, from an unborn HEAD onto an origin with no main, pushes a root commit", (t) => {
  const s = Scratch.create(t, { bootstrap: true });
  // Every script that reads HEAD works before there is one: the base is the empty tree.
  const diff = s.run("ship-diff", ["--stat"]);
  assert.equal(diff.code, 0, diff.stderr);
  assert.match(diff.stdout, /main\.ts/);
  const tree = s.checked();
  s.git(s.work, "add", "-A");
  assert.equal(s.git(s.work, "write-tree"), tree, "the hash is what `git add -A` would commit");
  s.git(s.work, "read-tree", "--empty");

  const out = s.ship(tree);
  assert.equal(out.code, 0, out.stderr);
  assert.deepEqual([s.log(), s.log(s.origin)], [["Ship it"], ["Ship it"]]);
  const head = s.git(s.work, "rev-parse", "HEAD");
  assert.equal(s.git(s.work, "rev-list", "--parents", "-n", "1", "HEAD"), head, "a root commit");
  assert.equal(s.git(s.work, "rev-parse", "refs/remotes/origin/main"), head);
  assert.equal(s.ledger().filter((row) => row[0] === "shipped").length, 1);

  // The next ship is an ordinary one, from the commit origin now holds.
  s.write("main.ts", "two\n");
  const next = s.ship(s.checked());
  assert.equal(next.code, 0, next.stderr);
  assert.deepEqual(s.log(s.origin), ["Ship it", "Ship it"]);
});

test("a first ship whose push failed resumes from its root commit, and nothing else does", (t) => {
  const s = Scratch.create(t, { bootstrap: true });
  const tree = s.checked();
  chmodSync(path.join(s.origin, "objects"), 0o555);
  const failed = s.ship(tree);
  chmodSync(path.join(s.origin, "objects"), 0o755);
  assert.equal(failed.code, 1, failed.stderr);
  assert.match(failed.stderr, /the push failed; the commit \S+ may be local or on origin/);
  assert.deepEqual([s.log(), s.log(s.origin)], [["Ship it"], []]);

  const resumed = s.ship(tree);
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.match(resumed.stdout, /pushing it rather than committing again/);
  assert.deepEqual([s.log(), s.log(s.origin)], [["Ship it"], ["Ship it"]]);
  const head = s.git(s.work, "rev-parse", "HEAD");
  assert.equal(s.git(s.work, "rev-parse", "refs/remotes/origin/main"), head);
  assert.equal(s.ledger().filter((row) => row[0] === "shipped").length, 1);

  // A root commit that does not hold the checked tree is not a resume.
  const other = Scratch.create(t, { bootstrap: true });
  other.git(other.work, "add", "-A");
  other.git(other.work, "commit", "-q", "--no-verify", "-m", "by hand");
  other.write("main.ts", "two\n");
  const differs = other.ship(other.checked());
  assert.equal(differs.code, 1, differs.stderr);
  assert.match(differs.stderr, /this clone has no refs\/remotes\/origin\/main/);
  assert.deepEqual(other.log(other.origin), []);
  // Nor is a commit with a parent, even one holding the checked tree.
  other.git(other.work, "add", "-A");
  other.git(other.work, "commit", "-q", "--no-verify", "-m", "second by hand");
  const parented = other.ship(other.checked());
  assert.equal(parented.code, 1, parented.stderr);
  assert.match(parented.stderr, /this clone has no refs\/remotes\/origin\/main/);
  assert.deepEqual(other.log(other.origin), []);

  // A resumed root commit's own message is judged raw, "#" lines included, as it would be pushed.
  const leak = ["# rotate AKIA", "ABCDEFGHIJKLMNOP"].join("");
  const hashed = Scratch.create(t, { bootstrap: true });
  hashed.git(hashed.work, "add", "-A");
  hashed.git(hashed.work, "commit", "-q", "--no-verify", "-m", `Start\n\n${leak}`);
  const refused = hashed.ship(hashed.checked());
  assert.equal(refused.code, 1, refused.stderr);
  assert.match(refused.stderr, /HEAD's message carries what looks like a credential/);
  assert.match(refused.stderr, /may be local or on origin/);
  assert.deepEqual(hashed.log(hashed.origin), []);
});

test("without refs/remotes/origin/main, only an unborn HEAD onto an origin with no main ships", (t) => {
  // Commits already made, and the tracking ref gone with no fetch to restore it.
  const s = Scratch.create(t);
  s.git(s.work, "config", "--unset-all", "remote.origin.fetch");
  s.git(s.work, "update-ref", "-d", "refs/remotes/origin/main");
  s.write("main.ts", "two\n");
  nothingShipped(s, s.ship(s.checked()), "this clone has no refs/remotes/origin/main");

  // Commits already made, onto an origin that is empty: still no root-commit exception.
  const e = Scratch.create(t);
  const empty = path.join(e.dir, "empty.git");
  e.git(e.dir, "init", "-q", "--bare", empty);
  e.git(e.work, "remote", "set-url", "origin", empty);
  e.git(e.work, "update-ref", "-d", "refs/remotes/origin/main");
  e.write("main.ts", "two\n");
  nothingShipped(e, e.ship(e.checked()), "this clone has no refs/remotes/origin/main");
  assert.deepEqual(e.log(empty), []);

  // An unborn HEAD, but origin has a main this clone has fetched.
  const u = Scratch.create(t);
  const other = Scratch.create(t, { bootstrap: true });
  other.git(other.work, "remote", "set-url", "origin", u.origin);
  other.git(other.work, "fetch", "-q", "origin");
  const fetched = other.ship(other.checked());
  assert.equal(fetched.code, 1);
  assert.match(fetched.stderr, /HEAD is unborn but origin has a main/);

  // An unborn HEAD, and origin has a main the clone never fetched as a tracking ref.
  other.git(other.work, "config", "--unset-all", "remote.origin.fetch");
  other.git(other.work, "update-ref", "-d", "refs/remotes/origin/main");
  const unfetched = other.ship(other.checked());
  assert.equal(unfetched.code, 1);
  assert.match(unfetched.stderr, /origin has a main this clone has not fetched/);
  assert.deepEqual(u.log(u.origin), ["first"]);
});

test("a local branch named origin/main does not stand in for origin's", (t) => {
  const s = Scratch.create(t);
  // Origin moves on, and this clone fetches it; a stale local branch keeps the old name.
  s.git(s.work, "branch", "origin/main", "HEAD");
  const other = path.join(s.dir, "other");
  s.git(s.dir, "clone", "-q", s.origin, other);
  writeFileSync(path.join(other, "theirs.ts"), "theirs\n");
  s.git(other, "add", "-A");
  s.git(other, "commit", "-q", "-m", "theirs");
  s.git(other, "push", "-q", "origin", "main");
  s.write("main.ts", "two\n");
  const out = s.ship(s.checked());
  assert.equal(out.code, 1, out.stderr);
  assert.match(out.stderr, /origin\/main has commits this clone lacks; nothing was committed/);
  assert.deepEqual(s.log(), ["first"]);
});

test("origin with more than one push URL is refused", (t) => {
  const s = Scratch.create(t);
  s.git(s.work, "config", "--add", "remote.origin.pushurl", s.origin);
  s.git(s.work, "config", "--add", "remote.origin.pushurl", path.join(s.dir, "second.git"));
  s.write("main.ts", "two\n");
  nothingShipped(s, s.ship(s.checked()), "origin has more than one push URL");
});

test("a hook that redirects the push leaves the commit local, and says it may be anywhere", (t) => {
  // url.*.insteadOf rewrites even an explicit URL, so a hook setting one sends the push to a decoy.
  const s = Scratch.create(t);
  const decoy = path.join(s.dir, "decoy.git");
  s.git(s.dir, "init", "-q", "--bare", decoy);
  s.write(
    ".githooks/pre-commit",
    `#!/usr/bin/env bash\ngit config url.${decoy}.insteadOf ${s.origin}\n`,
    0o755,
  );
  s.write("main.ts", "two\n");
  heldLocally(s, s.ship(s.checked()), "the url.* configuration changed during the commit");
  assert.deepEqual(s.log(decoy), []);

  // And one that changes origin's push URL.
  const p = Scratch.create(t);
  p.write(
    ".githooks/pre-commit",
    `#!/usr/bin/env bash\ngit config remote.origin.pushurl ${path.join(p.dir, "elsewhere.git")}\n`,
    0o755,
  );
  p.write("main.ts", "two\n");
  heldLocally(p, p.ship(p.checked()), "origin's push URL changed during the commit");
});

test("a hook that adds a commit on top leaves both local", (t) => {
  // commit-tree and update-ref, since a `git commit` here would run this hook again.
  const s = Scratch.create(t);
  s.write(
    ".githooks/post-commit",
    [
      "#!/usr/bin/env bash",
      'extra="$(git commit-tree "HEAD^{tree}" -p HEAD -m extra)"',
      'git update-ref refs/heads/main "$extra"',
      "",
    ].join("\n"),
    0o755,
  );
  s.write("main.ts", "two\n");
  heldLocally(s, s.ship(s.checked()), "HEAD is not exactly one new commit");
  assert.deepEqual(s.log(), ["extra", "Ship it", "first"]);
});

test("grafts cannot hide a commit a hook adds", (t) => {
  // The graft gives the hook's commit origin's main as its parent, so a check that honoured it would
  // see one new commit; the push would still send both.
  const s = Scratch.create(t);
  const first = s.git(s.work, "rev-parse", "HEAD");
  s.write(
    ".githooks/post-commit",
    [
      "#!/usr/bin/env bash",
      'extra="$(git commit-tree "HEAD^{tree}" -p HEAD -m extra)"',
      'git update-ref refs/heads/main "$extra"',
      `echo "$extra ${first}" > "$(git rev-parse --git-dir)/info/grafts"`,
      "",
    ].join("\n"),
    0o755,
  );
  s.write("main.ts", "two\n");
  heldLocally(s, s.ship(s.checked()), "HEAD is not exactly one new commit");
});

test("replace refs cannot show the checks a tree the push does not send", (t) => {
  // The pre-commit hook slips a file into the commit; the post-commit hook replaces that commit
  // with one holding the checked tree. A check that honoured the replacement would pass, and the
  // push would send the real commit.
  const s = Scratch.create(t);
  s.write(
    ".githooks/pre-commit",
    "#!/usr/bin/env bash\necho sneaked > sneaked.ts && git add sneaked.ts\n",
    0o755,
  );
  s.write(
    ".githooks/post-commit",
    [
      "#!/usr/bin/env bash",
      'fake="$(git commit-tree "$CHECKED_TREE" -p HEAD^ -m "Ship it")"',
      'git replace HEAD "$fake"',
      "",
    ].join("\n"),
    0o755,
  );
  s.write("main.ts", "two\n");
  const tree = s.checked();
  const out = s.run("commit-and-push", [tree, s.message], { CHECKED_TREE: tree });
  heldLocally(s, out, "the commit holds");
});

test("a tag named after the pushed hash cannot stand in for it", (t) => {
  // A ref named like the hash matches a push's source by name before any object does.
  const s = Scratch.create(t);
  s.write(
    ".githooks/post-commit",
    [
      "#!/usr/bin/env bash",
      'sha="$(git rev-parse HEAD)"',
      'decoy="$(git commit-tree "HEAD^{tree}" -p HEAD -m decoy)"',
      'git update-ref "refs/tags/$sha" "$decoy"',
      "",
    ].join("\n"),
    0o755,
  );
  s.write("main.ts", "two\n");
  const out = s.ship(s.checked());
  assert.equal(out.code, 0, out.stderr);
  assert.deepEqual(s.log(s.origin), ["Ship it", "first"]);
  assert.equal(s.git(s.origin, "rev-parse", "main"), s.git(s.work, "rev-parse", "HEAD"));
});

test("origin's main is read back after the push, and only then tracked", (t) => {
  const s = Scratch.create(t);
  s.write("main.ts", "two\n");
  const out = s.ship(s.checked());
  assert.equal(out.code, 0, out.stderr);
  // Pushed to a URL, which moves no tracking ref by itself.
  assert.equal(
    s.git(s.work, "rev-parse", "refs/remotes/origin/main"),
    s.git(s.work, "rev-parse", "HEAD"),
  );

  // Origin takes the push and puts its main back: the push reports success, the read-back does not.
  const r = Scratch.create(t);
  const first = r.git(r.work, "rev-parse", "HEAD");
  writeFileSync(
    path.join(r.origin, "hooks/post-receive"),
    '#!/usr/bin/env bash\nread -r old new ref\ngit update-ref "$ref" "$old"\n',
    { mode: 0o755 },
  );
  r.write("main.ts", "two\n");
  heldLocally(r, r.ship(r.checked()), `origin's main is ${first}, not`);
  assert.equal(r.git(r.work, "rev-parse", "refs/remotes/origin/main"), first);
});

test("a push origin took but the client saw fail still owes its decision, recorded once", (t) => {
  // Origin updates its main, then its receive-pack dies before reporting back.
  const s = Scratch.create(t);
  writeFileSync(path.join(s.origin, "hooks/post-receive"), "#!/bin/sh\nkill -9 $PPID\n", {
    mode: 0o755,
  });
  s.write("main.ts", "two\n");
  const tree = s.checked();
  const failed = s.ship(tree);
  assert.equal(failed.code, 1, failed.stderr);
  assert.match(failed.stderr, /may be local or on origin/);
  assert.ok(!failed.stderr.includes("nothing was committed"), failed.stderr);
  assert.deepEqual(s.log(s.origin), ["Ship it", "first"], "origin took it");
  // Run again, there is nothing left to push; the decision is still owed, and recorded once.
  const rerun = s.ship(tree);
  assert.equal(rerun.code, 0, rerun.stderr);
  assert.match(rerun.stdout, /nothing to do/);
  assert.equal(s.run("timed", ["--report"]).code, 2);
  assert.equal(s.ledger().filter((row) => row[0] === "shipped").length, 1);
});

test("a command that fails inside a function is the script's own failure, never a refusal", (t) => {
  // set -E carries the ERR trap into functions: without it, a failure there would exit with the
  // command's own status and no word of what happened.
  const s = Scratch.create(t);
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const fakes = path.join(s.dir, "fake-git");
  mkdirSync(fakes);
  writeFileSync(
    path.join(fakes, "git"),
    `#!/bin/sh\nif [ "$1" = ls-tree ]; then exit 1; fi\nexec ${realGit} "$@"\n`,
    { mode: 0o755 },
  );
  s.write("main.ts", "two\n");
  const tree = s.checked();
  const out = s.run("commit-and-push", [tree, s.message], {
    PATH: `${fakes}:${s.env()["PATH"] ?? ""}`,
  });
  assert.equal(out.code, 3, out.stderr);
  assert.match(out.stderr, /failed unexpectedly \(exit 1\); nothing was committed or pushed/);
  assert.deepEqual(s.log(s.origin), ["first"]);
});

test("a failure right after the commit still says the commit may be on origin", (t) => {
  // git that fails to read HEAD once the commit is made: the script stops before it has recorded
  // the commit, and still finds it.
  const s = Scratch.create(t);
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const fakes = path.join(s.dir, "fake-git");
  const mark = path.join(s.dir, "committed");
  mkdirSync(fakes);
  writeFileSync(
    path.join(fakes, "git"),
    [
      "#!/bin/sh",
      `if [ "$1" = commit ]; then ${realGit} "$@"; status=$?; touch ${mark}; exit $status; fi`,
      `if [ -e ${mark} ] && [ "$*" = "rev-parse --verify HEAD^{commit}" ]; then exit 1; fi`,
      `exec ${realGit} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  s.write("main.ts", "two\n");
  const tree = s.checked();
  const out = s.run("commit-and-push", [tree, s.message], {
    PATH: `${fakes}:${s.env()["PATH"] ?? ""}`,
  });
  assert.equal(out.code, 3, out.stderr);
  assert.match(out.stderr, /failed unexpectedly/);
  heldLocally(s, { ...out, code: 1 }, "failed unexpectedly");
  assert.deepEqual(s.log(), ["Ship it", "first"]);
});

test("paths are judged byte-wise whatever the locale, so a Latin-1 name ships as listed", (t) => {
  // Under a UTF-8 locale `[^/]` matches no byte that is not UTF-8, and the name would be refused.
  const s = Scratch.create(t);
  s.write(`${SHIP}/allowed-paths`, "^[^/]+$\n^\\.githooks/\n^tools/\n^src/[^/]+\\.ts$\n");
  s.git(s.work, "add", "-A");
  s.git(s.work, "commit", "-q", "--no-verify", "-m", "list");
  s.git(s.work, "push", "-q", "origin", "main");
  mkdirSync(path.join(s.work, "src"));
  writeFileSync(
    Buffer.concat([Buffer.from(`${s.work}/src/caf`), Buffer.from([0xe9]), Buffer.from(".ts")]),
    "export const x = 1;\n",
  );
  const tree = s.checked();
  const out = s.run("commit-and-push", [tree, s.message], { LC_ALL: "C.UTF-8" });
  assert.equal(out.code, 0, out.stderr);
  assert.deepEqual(s.log(s.origin), ["Ship it", "list", "first"]);
});

test("every ship script and hook runs strict, isolated bash (SH-14)", () => {
  const scripts: string[] = [];
  for (const dir of [SCRIPTS, HOOKS]) {
    for (const name of readdirSync(dir)) {
      const text = readFileSync(path.join(dir, name), "utf8");
      // The .ts helpers and the lists live here too; they are read, not run.
      if (text.startsWith("#!")) scripts.push(path.join(dir, name));
    }
  }
  assert.ok(scripts.length >= 13, scripts.join(" "));
  for (const script of scripts.sort()) {
    const lines = readFileSync(script, "utf8").split("\n");
    assert.equal(lines[0], "#!/usr/bin/env -S bash -p", script);
    assert.ok(lines.includes("set -eEuo pipefail"), `${script}: set -eEuo pipefail`);
    assert.ok(lines.includes("unset CDPATH"), `${script}: unset CDPATH`);
    assert.ok(
      lines.some((line) => /^export LC_ALL=C( |$)/.test(line)),
      `${script}: export LC_ALL=C`,
    );
  }
});

test("commit-and-push ignores replace refs and grafts, by a graft file that cannot exist", () => {
  const text = readFileSync(path.join(SCRIPTS, "commit-and-push"), "utf8");
  const exported = /^export (.*)$/m.exec(text)?.[1] ?? "";
  assert.match(exported, /\bGIT_NO_REPLACE_OBJECTS=1\b/);
  // /dev/null opens, and git then hints on every command; a path under it cannot be created.
  assert.match(exported, /\bGIT_GRAFT_FILE=\/dev\/null\/\S+/);
});

test("an origin that cannot be fetched is refused before anything is committed", (t) => {
  const s = Scratch.create(t);
  s.git(s.work, "remote", "set-url", "origin", path.join(s.dir, "gone.git"));
  s.write("main.ts", "two\n");
  nothingShipped(s, s.ship(s.checked()), "origin cannot be fetched");
});

test("a hook that moves HEAD off main leaves the commit local", (t) => {
  const s = Scratch.create(t);
  s.write(".githooks/post-commit", "#!/usr/bin/env bash\ngit checkout -q -b elsewhere\n", 0o755);
  s.write("main.ts", "two\n");
  heldLocally(s, s.ship(s.checked()), "a hook moved HEAD off main");
});

test("run without -p, an exported CDPATH still cannot send the scripts' own paths elsewhere", (t) => {
  // `bash script` skips the shebang's -p, so only `unset CDPATH` keeps a relative `cd` here.
  const s = Scratch.create(t);
  mkdirSync(path.join(s.dir, "decoy", SHIP), { recursive: true });
  s.write("main.ts", "two\n");
  const tree = s.checked();
  const out = s.exec("bash", [`${SHIP}/commit-and-push`, tree, s.message], {
    extra: { CDPATH: path.join(s.dir, "decoy") },
  });
  assert.equal(out.code, 0, out.stderr);
  assert.deepEqual(s.log(s.origin), ["Ship it", "first"]);
});
