/**
 * The paths a ship changes, as commit-and-push reads them: the further steps they call for, from
 * required-steps (SH-13), and the paths a ship may add at all, from allowed-paths, with a size
 * limit (SH-15). Both fail closed: a list that cannot be read as patterns refuses the ship.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { nothingShipped, ROOT, Scratch, SHIP } from "./scratch.ts";
import "../support/leaks.ts";

const RULES = `${SHIP}/required-steps`;
const ALLOWED = `${SHIP}/allowed-paths`;
const E2E = ["docker", "compose", "run", "--build", "--rm", "e2e"];

function build(s: Scratch, extra: Readonly<Record<string, string>> = {}): void {
  s.run("timed", ["re: build", ...E2E], extra);
}

test("a path that calls for a further step ships only once that step passed against the tree", (t) => {
  // An alternation, which only an extended regex reads; a blank line; and a comment that would
  // match every path if it were read as a pattern.
  const rules = `#|.\n\n^(ui|web)/\tre: build\t${E2E.join(" ")}\n`;

  // A watched path changed, and no build: refused, by name.
  const s = Scratch.create(t);
  s.write(RULES, rules);
  s.write("ui/page.ts", "page\n");
  nothingShipped(s, s.ship(s.checked()), "the latest 're: build' step");
  // One that failed is no better; one that passed against the tree ships.
  build(s, { FAIL: "e2e" });
  nothingShipped(s, s.ship(s.hash()), "'re: build'");
  build(s);
  const shipped = s.ship(s.hash());
  assert.equal(shipped.code, 0, shipped.stderr);

  // Resuming onto a commit made by hand: what it changed counts from origin, not from HEAD.
  const r = Scratch.create(t);
  r.write(RULES, rules);
  r.write("ui/page.ts", "page\n");
  r.git(r.work, "add", "-A");
  r.git(r.work, "commit", "-q", "-m", "by hand");
  const resumed = r.ship(r.checked());
  assert.equal(resumed.code, 1);
  assert.match(resumed.stderr, /the latest 're: build' step did not pass/);
  assert.deepEqual(r.log(r.origin), ["first"]);

  // A path no rule names needs nothing more than the gate and the full suite.
  const p = Scratch.create(t);
  p.write(RULES, rules);
  p.write("main.ts", "two\n");
  const plain = p.ship(p.checked());
  assert.equal(plain.code, 0, plain.stderr);
});

test("a rule naming a script by its relative path matches the step timed recorded it as (SH-13)", (t) => {
  const s = Scratch.create(t);
  s.write(RULES, "^ui/\tre: script\ttools/check.sh --all\n");
  s.write("tools/check.sh", "#!/bin/sh\nexit 0\n");
  chmodSync(path.join(s.work, "tools/check.sh"), 0o755);
  s.write("ui/page.ts", "page\n");
  // timed records the script's absolute path; the rule's relative one is resolved the same way.
  const ran = s.run("timed", ["re: script", "tools/check.sh", "--all"]);
  assert.equal(ran.code, 0, ran.stderr);
  const shipped = s.ship(s.checked());
  assert.equal(shipped.code, 0, shipped.stderr);
});

test("a path git would quote still calls for its step: names are read NUL-separated", (t) => {
  const s = Scratch.create(t);
  s.write(RULES, `^ui/\tre: build\t${E2E.join(" ")}\n`);
  // An accented name, which git prints quoted and escaped without -z.
  s.write("ui/café.ts", "page\n");
  nothingShipped(s, s.ship(s.checked()), "the latest 're: build' step");
});

test("a rules file that cannot be read as rules refuses the ship rather than requiring nothing", (t) => {
  const command = E2E.join(" ");
  const cases: [string, string, string][] = [
    ["an invalid pattern", `^(ui\tre: build\t${command}\n`, "is not a valid extended regex"],
    ["a missing column", "^ui/\tre: build\n", "is not <pattern><tab><label><tab><command>"],
    ["a doubled tab", `^ui/\t\tre: build\t${command}\n`, "is not <pattern><tab>"],
    ["a CRLF ending", `^ui/\tre: build\t${command}\r\n`, "is not <pattern><tab>"],
    ["a pattern after a space", ` ^ui/\tre: build\t${command}\n`, "is not <pattern><tab>"],
    ["a label holding a bar", `^ui/\tre|build\t${command}\n`, "is not <pattern><tab>"],
    ["the ledger's own label", `.\tstandard\ttrue\n`, "is not <pattern><tab>"],
    ["the other ledger label", `.\tshipped\ttrue\n`, "is not <pattern><tab>"],
  ];
  for (const [name, rules, reason] of cases) {
    const s = Scratch.create(t);
    s.write(RULES, rules);
    s.write("main.ts", "two\n");
    const out = s.ship(s.checked());
    assert.ok(out.stderr.includes(reason), `${name}: ${out.stderr}`);
    nothingShipped(s, out, `line 1 of ${RULES}`);
  }
  // A last rule with no newline after it is still a rule.
  const s = Scratch.create(t);
  s.write(RULES, `^ui/\tre: build\t${command}`);
  s.write("ui/page.ts", "page\n");
  nothingShipped(s, s.ship(s.checked()), "'re: build'");
});

test("a ship cannot drop the step it needs: origin's rules count, and a rename counts both names", (t) => {
  const rules = `^ui/\tre: build\t${E2E.join(" ")}\n`;
  /** A scratch repository whose origin already carries the rule and a file under ui/. */
  const withRule = (): Scratch => {
    const s = Scratch.create(t);
    s.landOnOrigin("rules", { [RULES]: rules, "ui/page.ts": "page\n" });
    return s;
  };
  // The rule removed in the same ship that changes ui/.
  const s = withRule();
  s.write(RULES, "# none\n");
  s.write("ui/page.ts", "changed\n");
  const dropped = s.ship(s.checked());
  assert.equal(dropped.code, 1);
  assert.match(dropped.stderr, /the latest 're: build' step/);

  // The file deleted outright.
  const d = withRule();
  rmSync(path.join(d.work, RULES));
  const deleted = d.ship(d.checked());
  assert.equal(deleted.code, 1);
  assert.match(deleted.stderr, /is on origin and gone from this tree/);

  // A file moved out of ui/: the old name is a changed path too.
  const m = withRule();
  m.git(m.work, "mv", "ui/page.ts", "page.ts");
  const moved = m.ship(m.checked());
  assert.equal(moved.code, 1);
  assert.match(moved.stderr, /the latest 're: build' step/);
});

test("the repository's own rules are well formed", () => {
  const text = readFileSync(path.join(ROOT, RULES), "utf8");
  assert.ok(text.endsWith("\n"), "the file ends with a newline");
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    const fields = line.split("\t");
    assert.equal(fields.length, 3, line);
    const grep = spawnSync("grep", ["-qE", "-e", fields[0] ?? ""], { input: "x\n" });
    assert.ok(grep.status === 0 || grep.status === 1, `not an extended regex: ${line}`);
  }
});

/** A scratch repository whose origin holds an allowed-paths list of the project's shape. */
function listed(t: Parameters<typeof Scratch.create>[0], list: string): Scratch {
  const s = Scratch.create(t);
  s.landOnOrigin("list", { [ALLOWED]: list });
  return s;
}
const LIST =
  "# the scratch layout\n^[^/]+\\.ts$\n^\\.git(ignore|hooks/)\n^\\.dockerignore$\n^tools/\n";

test("an added path no pattern admits is refused, and named", (t) => {
  const s = listed(t, LIST);
  s.write("notes/plan.md", "an agent's plan\n");
  s.write("out/result.json", "{}\n");
  s.write("main.ts", "two\n");
  const out = s.ship(s.checked());
  assert.match(out.stderr, /added paths no pattern in tools\/ship\/allowed-paths admits/);
  assert.match(out.stderr, /\n {2}notes\/plan\.md\n {2}out\/result\.json\n/);
  assert.equal(out.code, 1);
  assert.deepEqual(s.log(s.origin), ["list", "first"]);
});

test("the list is read from the tree being shipped: a new kind of file comes with its pattern", (t) => {
  const s = listed(t, LIST);
  s.write(ALLOWED, `${LIST}^docs/\n`);
  s.write("docs/guide.md", "how\n");
  const out = s.ship(s.checked());
  assert.equal(out.code, 0, out.stderr);
  // A path already tracked is not added, so a change to it needs no pattern.
  const p = listed(t, "^tools/\n");
  p.write("main.ts", "two\n");
  const changed = p.ship(p.checked());
  assert.equal(changed.code, 0, changed.stderr);
});

test("a list that cannot be read as patterns refuses the ship rather than admitting everything", (t) => {
  const cases: [string, string, string][] = [
    ["an invalid pattern", "^(tools\n", "line 1 of tools/ship/allowed-paths is not a valid"],
    ["an unanchored pattern", "tools/\n", "line 1 of tools/ship/allowed-paths is not one"],
    ["a space", "^tools/ \n", "line 1 of tools/ship/allowed-paths is not one"],
    ["a CRLF ending", "^tools/\r\n", "line 1 of tools/ship/allowed-paths is not one"],
    ["a bare anchor", "^\n", "line 1 of tools/ship/allowed-paths is not one"],
  ];
  for (const [name, list, reason] of cases) {
    const s = Scratch.create(t);
    s.write(ALLOWED, list);
    s.write("main.ts", "two\n");
    const out = s.ship(s.checked());
    assert.ok(out.stderr.includes(reason), `${name}: ${out.stderr}`);
    nothingShipped(s, out, reason);
  }
  // No list at all in the tree.
  const s = Scratch.create(t);
  rmSync(path.join(s.work, ALLOWED));
  s.write("main.ts", "two\n");
  nothingShipped(s, s.ship(s.checked()), "has no tools/ship/allowed-paths");
});

test("a file over 1 MiB is refused, added or grown; package-lock.json may reach 5 MiB", (t) => {
  const mib = 1024 * 1024;
  const big = (size: number): Buffer => Buffer.alloc(size, "a");
  const s = Scratch.create(t);
  s.write("dump.sql", big(mib + 1));
  nothingShipped(s, s.ship(s.checked()), "dump.sql (1048577 bytes, limit 1048576)");
  rmSync(path.join(s.work, "dump.sql"));
  // Exactly the limit is within it.
  s.write("data.ts", big(mib));
  s.write("package-lock.json", big(2 * mib));
  const fits = s.ship(s.checked());
  assert.equal(fits.code, 0, fits.stderr);

  // A tracked file grown past the limit, a lock file past its own, and one elsewhere past the
  // ordinary limit.
  const g = Scratch.create(t);
  g.write("main.ts", big(mib + 1));
  g.write("package-lock.json", big(5 * mib + 1));
  g.write("sub/package-lock.json", big(mib + 1));
  const out = g.ship(g.checked());
  assert.equal(out.code, 1, out.stderr);
  for (const name of ["main.ts", "package-lock.json (5242881 bytes", "sub/package-lock.json"]) {
    assert.ok(out.stderr.includes(`  ${name}`), `${name}: ${out.stderr}`);
  }
  assert.deepEqual(g.log(g.origin), ["first"]);
});

test("the repository's own list admits every file the repository holds", () => {
  // The first ship adds every one of them, so a path this refuses would stop it.
  const files = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "buffer",
  });
  assert.equal(files.status, 0, files.stderr.toString());
  let rest: Buffer = files.stdout;
  assert.ok(rest.length > 0, "git listed no files");
  const patterns = readFileSync(path.join(ROOT, ALLOWED), "utf8")
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"));
  for (const pattern of patterns) {
    assert.match(pattern, /^\^\S+$/, pattern);
    const grep = spawnSync("grep", ["-zavE", "-e", pattern], {
      input: rest,
      env: { LC_ALL: "C", PATH: process.env["PATH"] ?? "" },
    });
    assert.ok(grep.status === 0 || grep.status === 1, `not an extended regex: ${pattern}`);
    rest = grep.stdout;
  }
  assert.deepEqual(
    rest
      .toString("utf8")
      .split("\0")
      .filter((name) => name !== ""),
    [],
  );
});
