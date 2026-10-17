/**
 * The git-driven tools run end to end, in throwaway repositories. They need git, which the image
 * provides (TC-9); the logic they share with the pure-function tests is not retested here, only
 * what the command line adds: reading git, choosing files, and the exit status.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import "./support/leaks.ts";

const tools = path.join(path.dirname(import.meta.dirname), "tools");

function run(
  cwd: string,
  command: string,
  args: readonly string[],
): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A new repository with one commit holding `files`; the caller removes it. */
function repository(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "repo-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  const git = (...args: string[]): void => {
    const result = run(dir, "git", [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      ...args,
    ]);
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  };
  git("init", "--quiet", "--initial-branch=main");
  git("add", "--all");
  git("commit", "--quiet", "--message=base");
  return dir;
}

test("coercions lists what a change adds, in tracked and untracked files, and exits 3", () => {
  const dir = repository({ "a.ts": "export const a = 1;\n" });
  try {
    writeFileSync(
      path.join(dir, "a.ts"),
      "export const a = 1;\nexport const b = value as Thing;\n",
    );
    writeFileSync(path.join(dir, "new.ts"), "export const n = Number(text);\n");
    const result = run(dir, process.execPath, [path.join(tools, "coercions.ts"), "main"]);
    assert.equal(result.status, 3, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n").sort(), [
      "a.ts:2: as-cast: export const b = value as Thing;",
      "new.ts:1: Number(): export const n = Number(text);",
    ]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("coercions reads files whose names git would quote or treat as a pathspec", () => {
  const names = [":(glob)nothing.ts", "*.ts", 'q"x.ts', "sp ace.ts", "é.ts"];
  const dir = repository(Object.fromEntries(names.map((name) => [name, "export {};\n"])));
  try {
    for (const name of names) {
      writeFileSync(path.join(dir, name), "export {};\nexport const b = value as Thing;\n");
    }
    const result = run(dir, process.execPath, [path.join(tools, "coercions.ts"), "main"]);
    assert.equal(result.status, 3, result.stderr);
    assert.deepEqual(
      result.stdout.trim().split("\n").sort(),
      names.map((name) => `${name}:2: as-cast: export const b = value as Thing;`).sort(),
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("coercions exits 0 when a change adds none, and 2 when it cannot diff", () => {
  const dir = repository({ "a.ts": "export const a = 1;\n" });
  try {
    writeFileSync(path.join(dir, "a.ts"), "export const a = 2;\n");
    assert.equal(run(dir, process.execPath, [path.join(tools, "coercions.ts"), "main"]).status, 0);
    const missing = run(dir, process.execPath, [path.join(tools, "coercions.ts"), "no-such-ref"]);
    assert.equal(missing.status, 2);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("hidden-chars finds a literal hidden character, and --fix escapes it", () => {
  const nbsp = String.fromCharCode(0xa0);
  const dir = repository({ "a.ts": `export const s = "a${nbsp}b";\n`, "clean.md": "fine\n" });
  try {
    const found = run(dir, process.execPath, [path.join(tools, "hidden-chars.ts")]);
    assert.equal(found.status, 3);
    assert.equal(found.stdout.trim(), "a.ts:1: literal U+00A0");
    const fixed = run(dir, process.execPath, [path.join(tools, "hidden-chars.ts"), "--fix"]);
    assert.equal(fixed.status, 0);
    assert.equal(readFileSync(path.join(dir, "a.ts"), "utf8"), 'export const s = "a\\u00a0b";\n');
  } finally {
    rmSync(dir, { recursive: true });
  }
});
