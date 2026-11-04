/**
 * A scratch repository with a bare origin, for running the ship's scripts for real (SH-10, SH-11):
 * what they guarantee is mechanical, so it is tested the same way. Each test gets its own, removed
 * when it ends. Nothing comes from the developer's git configuration or from a ship in progress in
 * the real repository: the environment is built here, whole.
 *
 * The scripts are copied from tools/ship/, or from SHIP_SCRIPTS_DIR when that names a scratch copy
 * holding a mutant (TS-5), so a guard's test can be shown to fail without touching the real script.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const SCRIPTS = process.env["SHIP_SCRIPTS_DIR"] ?? path.join(ROOT, "tools/ship");
export const HOOKS = process.env["SHIP_HOOKS_DIR"] ?? path.join(ROOT, ".githooks");
export const SHIP = "tools/ship";
export const GATE = `${SHIP}/gate`;
/** The suite's command, as the ship runs it and as commit-and-push requires it by default. */
export const SUITE = ["docker", "compose", "run", "--build", "--rm", "check"];
/**
 * A command the fake docker answers, named by a bare word a shell function could shadow: for the
 * tests that vary a command's words or shadow it, which SUITE cannot serve once a project sets its
 * own suite. A suite that is a path, `tools/check`, made both kinds pass with their guards removed.
 */
export const DOCKER_STEP = ["docker", "compose", "run", "--build", "--rm", "check"];

export interface Out {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * A docker that records each call and passes, unless FAIL is "docker" or the call's last argument;
 * DURING is a shell command it runs first, standing for an edit made while a check runs. Its
 * failure output ends the way a passing run's does, so only an exit status can tell them apart.
 */
const FAKE_DOCKER = [
  "#!/usr/bin/env bash",
  'printf "%s\\n" "$*" >> "$FAKE_CALLS"',
  'if [ -n "${DURING:-}" ]; then sh -c "$DURING"; fi',
  'if [ "${FAIL:-}" = docker ] || [ "${FAIL:-}" = "${!#}" ]; then',
  '  printf "error: the real problem\\n9 tests passed\\n"; exit 1',
  "fi",
  'echo "9 tests passed"',
  "",
].join("\n");

/** Every file of `from` copied into `to`, modes kept, so a script stays executable. */
export function copyScripts(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const source = path.join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, path.join(to, name));
    chmodSync(path.join(to, name), statSync(source).mode & 0o777);
  }
}

export interface ScratchOptions {
  /** No commit and no push yet: an unborn HEAD and an origin with no main, as the first ship has. */
  readonly bootstrap?: boolean;
}

export class Scratch {
  readonly dir: string;
  readonly work: string;
  readonly origin: string;
  readonly bin: string;
  readonly message: string;

  private constructor(dir: string) {
    this.dir = dir;
    this.work = path.join(dir, "work");
    this.origin = path.join(dir, "origin.git");
    this.bin = path.join(dir, "bin");
    this.message = path.join(dir, "message");
  }

  /** A scratch repository for one test, removed when the test ends. */
  static create(t: TestContext, options: ScratchOptions = {}): Scratch {
    const s = new Scratch(mkdtempSync(path.join(tmpdir(), "ship-")));
    t.after(() => {
      s.dispose();
    });
    mkdirSync(s.bin);
    writeFileSync(path.join(s.bin, "docker"), FAKE_DOCKER, { mode: 0o755 });
    writeFileSync(
      path.join(s.dir, "gitconfig"),
      "[user]\n\tname = t\n\temail = t@t.invalid\n[init]\n\tdefaultBranch = main\n",
    );
    s.git(s.dir, "-c", "init.defaultBranch=main", "init", "-q", "--bare", s.origin);
    s.git(s.dir, "-c", "init.defaultBranch=main", "init", "-q", s.work);
    copyScripts(SCRIPTS, path.join(s.work, SHIP));
    // The scratch layout is not the project's; tests of SH-15 and SH-13 write their own lists.
    s.write(`${SHIP}/allowed-paths`, "# anything\n^.\n");
    s.write(`${SHIP}/required-steps`, "# none\n");
    s.write(".gitignore", "ignored.txt\n*.token\n");
    s.write(".dockerignore", "ignored.txt\n");
    s.write("main.ts", "one\n");
    // The repository's own arrangement: a pre-commit hook in .githooks, enabled.
    s.write(".githooks/pre-commit", "#!/usr/bin/env bash\nexit 0\n", 0o755);
    s.git(s.work, "config", "core.hooksPath", ".githooks");
    s.git(s.work, "remote", "add", "origin", s.origin);
    if (options.bootstrap !== true) {
      s.git(s.work, "add", "-A");
      s.git(s.work, "commit", "-q", "-m", "first");
      s.git(s.work, "push", "-q", "-u", "origin", "main");
    }
    writeFileSync(s.message, "Ship it\n\nBecause.\n");
    const started = s.run("timed", ["--start"]);
    assert.equal(started.code, 0, started.stderr);
    return s;
  }

  dispose(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }

  /** The environment every command here gets, and nothing else. */
  env(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
    return {
      PATH: `${this.bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`,
      HOME: this.dir,
      GIT_CONFIG_GLOBAL: path.join(this.dir, "gitconfig"),
      GIT_CONFIG_NOSYSTEM: "1",
      SHIP_NODE: process.execPath,
      FAKE_CALLS: path.join(this.dir, "calls"),
      ...extra,
    };
  }

  /** Any program, from `cwd` (the work tree by default), with this repository's environment. */
  exec(
    file: string,
    args: readonly string[],
    options: { readonly cwd?: string; readonly extra?: Readonly<Record<string, string>> } = {},
  ): Out {
    const out = spawnSync(file, args, {
      cwd: options.cwd ?? this.work,
      env: this.env(options.extra),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: out.status, stdout: out.stdout, stderr: out.stderr };
  }

  /** git, which must succeed; its output, trimmed. */
  git(cwd: string, ...args: string[]): string {
    const out = this.exec("git", args, { cwd });
    assert.equal(out.code, 0, `git ${args.join(" ")}: ${out.stderr}`);
    return out.stdout.trim();
  }

  /** One of the ship's scripts, run from the scratch repository as a ship runs it. */
  run(
    script: string,
    args: readonly string[] = [],
    extra: Readonly<Record<string, string>> = {},
  ): Out {
    return this.exec(path.join(this.work, SHIP, script), args, { extra });
  }

  write(relative: string, text: string | Buffer, mode = 0o644): void {
    const file = path.join(this.work, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    chmodSync(file, mode);
  }

  read(relative: string): string {
    return readFileSync(path.join(this.work, relative), "utf8");
  }

  exists(relative: string): boolean {
    return existsSync(path.join(this.work, relative));
  }

  hash(): string {
    const out = this.run("tree-hash");
    assert.equal(out.code, 0, out.stderr);
    return out.stdout.trim();
  }

  gate(extra: Readonly<Record<string, string>> = {}): Out {
    return this.run("timed", ["gate", GATE], extra);
  }

  full(extra: Readonly<Record<string, string>> = {}): Out {
    return this.run("timed", ["test", ...SUITE], extra);
  }

  /** The passing gate and full run a ship needs, against the tree as it is. */
  checked(): string {
    const gate = this.gate();
    assert.equal(gate.code, 0, gate.stderr);
    const full = this.full();
    assert.equal(full.code, 0, full.stderr);
    return this.hash();
  }

  ship(tree: string, ...rest: string[]): Out {
    return this.run("commit-and-push", [tree, this.message, ...rest]);
  }

  /** The subjects on `ref` in `where`, newest first; none for a ref that does not exist. */
  log(where = this.work, ref = "main"): string[] {
    const out = this.exec("git", ["log", "--format=%s", ref, "--"], { cwd: where });
    return out.code === 0 ? out.stdout.trim().split("\n") : [];
  }

  /** The ledger's rows, each split into its fields. */
  ledger(): string[][] {
    const file = path.join(this.work, ".git/ship-timings.ledger");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((row) => row !== "")
      .map((row) => row.split("\t"));
  }

  /** Commits `files` by hand, past every hook, and pushes them: what origin already holds. */
  landOnOrigin(subject: string, files: Readonly<Record<string, string>>): void {
    for (const [name, text] of Object.entries(files)) this.write(name, text);
    this.git(this.work, "add", "-A");
    this.git(this.work, "commit", "-q", "--no-verify", "-m", subject);
    this.git(this.work, "push", "-q", "origin", "main");
  }
}

/** Nothing committed or pushed: the refusal left the world as it found it, and said so. */
export function nothingShipped(s: Scratch, out: Out, reason: string): void {
  assert.equal(out.code, 1, out.stderr);
  assert.ok(out.stderr.includes(reason), `expected "${reason}" in: ${out.stderr}`);
  assert.ok(out.stderr.includes("nothing was committed or pushed"), out.stderr);
  assert.deepEqual([s.log(), s.log(s.origin)], [["first"], ["first"]]);
}

/** A refusal after a commit exists: it never says nothing was committed, and nothing was pushed. */
export function heldLocally(s: Scratch, out: Out, reason: string): void {
  assert.equal(out.code, 1, out.stderr);
  assert.ok(out.stderr.includes(reason), `expected "${reason}" in: ${out.stderr}`);
  assert.ok(out.stderr.includes("may be local or on origin"), out.stderr);
  assert.ok(!out.stderr.includes("nothing was committed"), out.stderr);
  assert.deepEqual(s.log(s.origin), ["first"]);
}

/** A line the secrets check refuses, assembled here so this file holds no secret-shaped line. */
export const LEAK = [
  "const pass",
  "word = ",
  JSON.stringify("Zq7f-not-a-real-one-9xK"),
  ";\n",
].join("");
