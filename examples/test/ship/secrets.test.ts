/**
 * The secrets check (SH-12), in the hook, the gate and on the message: the shapes it refuses, the
 * hash list it reads from the base as well as the tree, the allow list it reads the inverse way,
 * and the names and bytes that must not slip past it. Secret-shaped values are assembled at run
 * time, so this file holds none for the real gate to refuse.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  candidates,
  guids,
  judge,
  linesWithKnown,
  parseHashes,
  sha256,
} from "../../tools/ship/check-secret-hashes.ts";
import { LEAK, ROOT, Scratch, SHIP } from "./scratch.ts";
import "../support/leaks.ts";

/** The exit status and output of the check over one line, as a commit message. */
function judgeLine(s: Scratch, line: string, extra: Readonly<Record<string, string>> = {}) {
  writeFileSync(path.join(s.dir, "msg"), `${line}\n`);
  return s.run("secrets_check.sh", ["--file", path.join(s.dir, "msg")], extra);
}

/** The check over the staged change, as the hook runs it. */
function staged(s: Scratch, files: Readonly<Record<string, string | Buffer>>) {
  for (const [name, text] of Object.entries(files)) s.write(name, text);
  s.git(s.work, "add", "-A");
  return s.run("secrets_check.sh");
}

test("each token shape is found after an underscore, and not joined to a letter or in a longer run", (t) => {
  const cases: [string, string, string][] = [
    ["AWS access key", "AKIA" + "ABCDEFGHIJKLMNOP", "9"],
    ["AWS Bedrock API key", "ABSK" + "a".repeat(24), ""],
    ["GitHub token", "ghp_" + "A1b2C3d4".repeat(5), ""],
    ["GitHub token", "gho_" + "Z".repeat(36), ""],
    ["GitHub token", "github_pat_" + "11ABC_".repeat(5), ""],
    ["Slack token", "xoxb-" + "1234-5678-abcd", ""],
    ["Google API key", "AIza" + "Sy".repeat(17) + "Q", "x"],
  ];
  const s = Scratch.create(t);
  for (const [label, token, more] of cases) {
    const found = judgeLine(s, `KEY_${token}_OLD=1`);
    assert.equal(found.code, 1, token);
    assert.match(found.stdout, new RegExp(`${label}: 1 added line`), token);
    assert.equal(judgeLine(s, `KEYX${token}`).code, 0, `joined to a letter: ${token}`);
    if (more !== "") assert.equal(judgeLine(s, `${token}${more}`).code, 0, `longer: ${token}`);
  }
  // A prefix no listed vendor issues.
  assert.equal(judgeLine(s, ["dba", "as_", "f".repeat(20)].join("")).code, 0);
});

test("keys, auth headers, SSNs, password literals and URL passwords are refused; references are not", (t) => {
  const s = Scratch.create(t);
  const refused: [string, string][] = [
    ["SSN-shaped value", `id ${["123", "45", "6789"].join("-")}`],
    // Joined at run time, never in a template: lint's autofix would inline a template's pieces.
    ["private key", ["-----BEGIN RSA PRIVATE", " KEY-----"].join("")],
    ["Basic auth header", ["Authorization: Bas", "ic dXNlcjpwYXNzd29yZDEy"].join("")],
    ["password literal", ["const pass", 'word = "hunter2hunter2";'].join("")],
    ["password literal", ["sec", "ret: Xk9-very-plain"].join("")],
    ["password literal", ["pass", "word: 'hunterhunter'"].join("")],
    ["password literal", ["ownerPass", "word: hunterhunter,"].join("")],
    ["password literal", ["APP_OWNER_PASS", "WORD: hunterhunter"].join("")],
    // A message is not a source file, so a name in capitals is a literal here; source files are
    // covered by "a constant's name passes only in source files".
    ["password literal", ["pass", "word = ROLE_PASSWORD;"].join("")],
    ["password literal", ["APP_OWNER_PASS", "WORD: K7QX9P2MZ4R8T1WQ"].join("")],
    ["password literal", ["APP_OWNER_PASS", "WORD=K7QX9P2MZ4R8T1WQ"].join("")],
    ["password literal", ["  APP_OWNER_PASS", 'WORD: "K7QX9P2MZ4R8T1WQ"'].join("")],
    ["password literal", ['{"pass', 'word":"hunterhunter"}'].join("")],
    ["password literal", ["{pass", "word:'hunterhunter'}"].join("")],
    ["password in a URL", ["postgres://app:", "s3cretpass@db/app"].join("")],
    ["password in a URL", ["redis://:", "s3cretpass@cache"].join("")],
  ];
  for (const [label, line] of refused) {
    const out = judgeLine(s, line);
    assert.equal(out.code, 1, line);
    assert.match(out.stdout, new RegExp(label), line);
    assert.ok(!out.stdout.includes(line), "a finding never prints the value");
  }
  const allowed = [
    ["pass", "word: string;"].join(""),
    ["pass", "word: boolean;"].join(""),
    ["pass", "word = config.database.password;"].join(""),
    // A key in any case names a reference just as a lowercase one does.
    ["ownerPass", "word: config.ownerPassword,"].join(""),
    ["APP_OWNER_PASS", "WORD: config.APP_OWNER_PASSWORD,"].join(""),
    ["Pass", "word: string;"].join(""),
    // psql's interpolation of a variable set with --set, as a database's init script may use it.
    ["create role app_owner login pass", "word :'owner_password';"].join(""),
    ["create role app_user login pass", 'word :"app_password";'].join(""),
    ["postgres://app:", "${PGPASSWORD}@db/app"].join(""),
    ["postgres://app:", "5432/app"].join(""),
    ["pass", "word = ${POSTGRES_PASSWORD:?required}"].join(""),
    "the basic idea",
  ];
  for (const line of allowed) assert.equal(judgeLine(s, line).code, 0, line);
});

test("a constant's name passes only in source files; in YAML, .env or JSON capitals are a literal", (t) => {
  const names = [
    ["pass", "word = ROLE_PASSWORD;"].join(""),
    ["connect({ pass", "word: ROLE_PASSWORD, user })"].join(""),
    ["const role = { pass", "word: ROLE_PASSWORD};"].join(""),
    // A default parameter: the terminator ends the name, whatever code follows it.
    ["async function f(pass", "word = PASSPHRASE): Promise<void> {"].join(""),
  ];
  for (const file of ["src/a.ts", "src/b.tsx", "tools/c.mjs", "lib/d.js", "e.cts"]) {
    const out = staged(Scratch.create(t), { [file]: `${names.join("\n")}\n` });
    assert.equal(out.code, 0, `${file}: ${out.stdout}`);
  }
  // Capitals then a terminator then more of the value: a literal holding a brace, not a name.
  const braced = staged(Scratch.create(t), {
    "src/a.ts": `${["pass", "word=AB}k8sXq29zz"].join("")}\n`,
  });
  assert.equal(braced.code, 1, braced.stdout);
  assert.match(braced.stdout, /password literal: 1 match/);
  // The same lines, and YAML's flow style, are literals in a file that has no constants.
  const flow = ["db: {pass", "word: K7QX9P2M, user: app}"].join("");
  for (const file of ["compose.yaml", "deploy/x.yml", ".env.example", "config.json", "a.ts.md"]) {
    for (const line of [...names, flow]) {
      const out = staged(Scratch.create(t), { [file]: `${line}\n` });
      assert.equal(out.code, 1, `${file}: ${line}`);
      assert.match(out.stdout, /password literal: 1 match/, `${file}: ${line}`);
    }
  }
  // Lines are judged by their own file's kind when one change holds both: the source file's name
  // passes, the YAML file's literal does not, in either order.
  for (const [first, second] of [
    ["a.yaml", "b.ts"],
    ["b.ts", "c.yaml"],
  ] as const) {
    const out = staged(Scratch.create(t), {
      [first]: first.endsWith(".ts") ? `${names[0] ?? ""}\n` : `${flow}\n`,
      [second]: second.endsWith(".ts") ? `${names[0] ?? ""}\n` : `${flow}\n`,
    });
    assert.equal(out.code, 1, `${first} then ${second}`);
    assert.match(out.stdout, /password literal: 1 match/, `${first} then ${second}`);
  }
});

test("a published development password passes only while the base's allow list holds it too", (t) => {
  const line = ["POSTGRES_PASS", "WORD: dev-superuser\n"].join("");
  const listed = { [`${SHIP}/secrets_allow.txt`]: "dev-superuser\n" };
  const s = Scratch.create(t);
  // Once the base holds the entry, the published development password counts as allowed.
  s.landOnOrigin("allow list", listed);
  assert.equal(staged(s, { "compose.yaml": line }).code, 0);
  // A value listed in the same change that adds it does not count yet.
  const n = Scratch.create(t);
  const fresh = ["DB_PASS", "WORD: brand-new-value\n"].join("");
  const out = staged(n, {
    [`${SHIP}/secrets_allow.txt`]: "dev-superuser\nbrand-new-value\n",
    "compose.yaml": fresh,
  });
  assert.equal(out.code, 1, out.stdout);
  assert.match(out.stdout, /password literal/);
  // Before the first commit there is no base, and the tree's list is the whole of it.
  const b = Scratch.create(t, { bootstrap: true });
  assert.equal(staged(b, { ...listed, "compose.yaml": line }).code, 0);
  // A blank or short entry would excuse nearly everything, so the list is refused.
  const short = Scratch.create(t);
  const refused = staged(short, { [`${SHIP}/secrets_allow.txt`]: "dev-app-pw\nabc\n" });
  assert.equal(refused.code, 1);
  assert.match(refused.stdout, /secrets_allow\.txt is unreadable, or has an entry/);
});

test("a .env value in an added line is refused by count, and forbidden paths by name", (t) => {
  const s = Scratch.create(t);
  s.write(".gitignore", "ignored.txt\n*.token\n.env\n");
  writeFileSync(path.join(s.work, ".env"), 'DB_URL="value-from-dot-env"\n');
  const leaked = staged(s, { "main.ts": "const url = 'value-from-dot-env';\n" });
  assert.equal(leaked.code, 1);
  assert.match(leaked.stdout, /A \.env VALUE APPEARS IN 1 ADDED LINE\(S\)/);
  assert.ok(!leaked.stdout.includes("value-from-dot-env"));

  for (const name of [
    "sub/.env",
    "key.pem",
    "id_ed25519",
    "deploy/site.p12",
    "node_modules/x.js",
  ]) {
    const f = Scratch.create(t);
    const out = staged(f, { [name]: "x\n" });
    assert.equal(out.code, 1, name);
    assert.match(out.stdout, /FORBIDDEN PATH STAGED/, name);
  }
  const example = Scratch.create(t);
  assert.equal(staged(example, { ".env.example": "DB_URL=\n" }).code, 0);
});

test("a message is judged whole, as git may keep it, and a mistyped mode is refused", (t) => {
  const ssn = ["123", "45", "6789"].join("-");
  const s = Scratch.create(t);
  const run = (text: string): number | null => {
    writeFileSync(path.join(s.dir, "msg"), text);
    return s.run("secrets_check.sh", ["--file", path.join(s.dir, "msg")]).code;
  };
  assert.equal(run(`Fix it\n\nid ${ssn}\n`), 1);
  // Lines git strips only in some cleanup modes: "#" lines, and anything below a scissors line.
  // `-m`, `-F` and `--file` keep them, so they are judged too.
  assert.equal(run(`Fix it\n# id ${ssn}\n`), 1);
  const scissors = `# ${"-".repeat(24)} >8 ${"-".repeat(24)}`;
  assert.equal(run(`Fix it\n\n${scissors}\n-const id = "${ssn}";\n`), 1);
  assert.equal(run(`Fix it ${ssn}\n\n${scissors}\n`), 1);
  for (const args of [["--files", path.join(s.dir, "msg")], ["--file"], ["--file", "/no/such"]]) {
    const out = s.run("secrets_check.sh", args);
    assert.equal(out.code, 2, args.join(" "));
    assert.match(out.stderr, /usage: secrets_check\.sh/);
  }
  // A check that cannot run is its own status, never a pass and never a finding.
  const broken = s.run("secrets_check.sh", [], { CHECK_BASE: "no-such-revision" });
  assert.equal(broken.code, 3, broken.stderr);
});

test("a value the hash list names is looked up, and a lookup that fails is a failure", (t) => {
  const value = ["zq7f", "unshaped", "value", "9xk"].join("-");
  const s = Scratch.create(t);
  // A node that records its runs, so a lookup that never starts can be told from one that passed.
  const recorder = path.join(s.dir, "node-recorder");
  writeFileSync(
    recorder,
    `#!/bin/sh\necho ran >> "${s.dir}/node-runs"\nexec ${process.execPath} "$@"\n`,
    {
      mode: 0o755,
    },
  );
  const runs = (): number => {
    const file = path.join(s.dir, "node-runs");
    return existsSync(file) ? readFileSync(file, "utf8").split("\n").length - 1 : 0;
  };
  // No digest listed: node is never started, so a hook costs nothing until one is.
  s.write("main.ts", `const x = "${value}";\n`);
  s.git(s.work, "add", "-A");
  assert.equal(s.run("secrets_check.sh", [], { SHIP_NODE: recorder }).code, 0);
  assert.equal(runs(), 0);

  s.write("tools/secret-hashes.txt", `# a note\n${sha256("some-other-value-entirely")}\n`);
  s.git(s.work, "add", "-A");
  const clean = s.run("secrets_check.sh", [], { SHIP_NODE: recorder });
  assert.equal(clean.code, 0, clean.stdout);
  assert.equal(runs(), 1);

  s.write("tools/secret-hashes.txt", `${sha256(value)}\n`);
  s.git(s.work, "add", "-A");
  const found = s.run("secrets_check.sh");
  assert.equal(found.code, 1);
  assert.match(found.stdout, /known secret value: 1 added line\(s\)/);
  assert.match(found.stdout, /the known-secret check found a listed value/);
  assert.ok(!found.stdout.includes(value));
  const unrunnable = s.run("secrets_check.sh", [], { SHIP_NODE: "/bin/false" });
  assert.equal(unrunnable.code, 1);
  assert.match(unrunnable.stdout, /the known-secret check could not run \(exit 1\)/);

  // A digest the base holds still counts when the change removes it from the tree's list.
  const b = Scratch.create(t);
  b.landOnOrigin("list", { "tools/secret-hashes.txt": `${sha256(value)}\n` });
  b.write("tools/secret-hashes.txt", "# emptied\n");
  b.write("main.ts", `${value}\n`);
  b.git(b.work, "add", "-A");
  const dropped = b.run("secrets_check.sh");
  assert.equal(dropped.code, 1, dropped.stdout);
  assert.match(dropped.stdout, /known secret value/);
});

test("a byte that is not UTF-8 inside the value hides nothing, whatever the locale", (t) => {
  // Under a UTF-8 locale `[^"']` would not match the byte, and the literal would be too short.
  const s = Scratch.create(t);
  const line = Buffer.concat([
    Buffer.from(["const pass", 'word = "abcd'].join("")),
    Buffer.from([0xff]),
    Buffer.from('efghijkl";\n'),
  ]);
  s.write("main.ts", line);
  s.git(s.work, "add", "-A");
  const out = s.run("secrets_check.sh", [], { LC_ALL: "C.UTF-8" });
  assert.equal(out.code, 1, out.stdout);
  assert.match(out.stdout, /password literal: 1 match/);
  // A NUL byte makes git call a file binary and grep call it "binary file matches"; the lines are
  // scanned all the same.
  const n = Scratch.create(t);
  n.write("data.ts", Buffer.concat([Buffer.from([0]), Buffer.from(`\n${LEAK}`)]));
  n.git(n.work, "add", "-A");
  const binary = n.run("secrets_check.sh");
  assert.equal(binary.code, 1, binary.stdout);
  assert.match(binary.stdout, /password literal: 1 match/);
});

test("names git would quote or read as pathspecs, and lines starting ++, are all scanned", (t) => {
  const leak = ["const pass", 'word = "hunter2hunter2";\n'].join("");
  const names = [
    'q"x.ts',
    "with space.ts",
    "café.ts",
    "*.md",
    ":(glob)x.ts",
    "-dash.ts",
    "new\nline.ts",
  ];
  for (const name of names) {
    const s = Scratch.create(t);
    const out = staged(s, { [name]: leak });
    assert.equal(out.code, 1, `${name}: ${out.stdout}`);
    assert.match(out.stdout, /password literal: 1 match/, name);
  }
  // An added line whose text starts "++" reads "+++" in a diff, like a file header.
  const s = Scratch.create(t);
  const plus = staged(s, { "notes.txt": `++ ${leak}` });
  assert.equal(plus.code, 1, plus.stdout);
});

test("each file is diffed alone and wholly when renamed; a deleted file brings in no other's lines", (t) => {
  const leak = ["pass", "word: hunterhunter\n"].join("");
  // Renamed with one line changed: the line that moved with it is scanned too.
  const r = Scratch.create(t);
  r.landOnOrigin("config", { "conf.yml": `name: app\n${leak}` });
  r.git(r.work, "mv", "conf.yml", "moved.yml");
  const renamed = staged(r, { "moved.yml": `name: other\n${leak}` });
  assert.equal(renamed.code, 1, renamed.stdout);
  assert.match(renamed.stdout, /password literal: 1 match/);
  // A file deleted where a directory of the same name is added: each added line counted once.
  const d = Scratch.create(t);
  d.landOnOrigin("file", { "a.ts": "export const a = 1;\n" });
  d.git(d.work, "rm", "-q", "a.ts");
  const replaced = staged(d, { "a.ts/in.yml": leak });
  assert.equal(replaced.code, 1, replaced.stdout);
  assert.match(replaced.stdout, /password literal: 1 match\b/);
});

test("an exported CDPATH cannot redirect the path the secrets check reads its allow list from", (t) => {
  const s = Scratch.create(t);
  // A decoy with the same relative path: with CDPATH honoured, `cd` would go there and print it.
  mkdirSync(path.join(s.dir, "decoy", SHIP), { recursive: true });
  s.write("main.ts", "two\n");
  s.git(s.work, "add", "-A");
  // Run by its relative path, as the hook runs it, since only a relative path consults CDPATH; and
  // by `bash`, which skips the shebang's -p, so only `unset CDPATH` stands in the way.
  const out = s.exec("bash", [`${SHIP}/secrets_check.sh`], {
    extra: { CDPATH: path.join(s.dir, "decoy") },
  });
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /secrets check: clean/);
});

test("the hash lookup finds a listed value in any span or GUID form, and counts lines", () => {
  assert.deepEqual(guids("id=3F2504E0-4F89-11D3-9A0C-0305E82C3301&x"), [
    "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  ]);
  assert.deepEqual(guids("3f2504e04f8911d39a0c0305e82c3301"), [
    "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  ]);
  assert.ok(candidates("dump-ABCDEFGHIJKL").includes("abcdefghijkl"));
  assert.ok(candidates("VAR:-abcdefghijklm").includes("abcdefghijklm"));
  const known = parseHashes(`# note\n${sha256("abcdefghijklm")} # trailing\nnot-a-digest\n`);
  assert.equal(known.size, 1);
  assert.equal(linesWithKnown(["x ABCDEFGHIJKLM y", "nothing", "pre_abcdefghijklm"], known), 2);
  const lines: string[] = [];
  assert.equal(
    judge(`${sha256("abcdefghijklm")}\n`, "a abcdefghijklm\n", (l) => lines.push(l)),
    3,
  );
  assert.deepEqual(lines, ["known secret value: 1 added line(s)"]);
  assert.equal(judge("", "a abcdefghijklm\n"), 0);
});

test("the repository's lists: no allowed value and no digest yet", () => {
  assert.equal(readFileSync(path.join(ROOT, SHIP, "secrets_allow.txt"), "utf8"), "");
  const hashes = readFileSync(path.join(ROOT, "tools/secret-hashes.txt"), "utf8");
  assert.equal(parseHashes(hashes).size, 0);
  // It says how to add one without the value reaching the screen or the shell's history.
  assert.match(hashes, /read -rs VALUE/);
});
