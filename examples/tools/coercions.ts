/**
 * Lists every coercion on the lines a change adds (BD-2), for review to judge. Lint already refuses
 * `as`, `!` and `any`; this finds what lint cannot judge, and flags the rest again for files lint
 * exempts.
 *
 *   node tools/coercions.ts [<base>]   list coercions added since the merge-base with <base>
 *                                      (default origin/main), untracked files included
 *
 * Exit status: 0 none found, 3 coercions listed for review, 2 the check itself could not run.
 *
 * How it reads a diff, each point a hole found in a diff-reading scanner (SH-12):
 * - file names come from `--name-only -z`, never from `+++` headers, which git quotes or suffixes;
 * - each file is diffed alone, with `--text`, so git never shows it only as "Binary files differ";
 * - added lines are counted by each hunk's header, so an added line that itself begins `++` is
 *   still read as added, not mistaken for a header.
 * It matches one line at a time, so it is a list for a reviewer, not a parser: it skips comment
 * lines and imports, and still flags `as` in prose inside a string.
 */
import { execFileSync } from "node:child_process";

export interface Added {
  readonly line: number;
  readonly text: string;
}

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** The added lines of a single file's unified diff, numbered as in the new file. */
export function addedLines(diff: string): readonly Added[] {
  const added: Added[] = [];
  const lines = diff.split("\n");
  let i = 0;
  while (i < lines.length) {
    const hunk = HUNK.exec(lines[i] ?? "");
    i += 1;
    if (hunk === null) continue;
    // Each group is digits only, by the pattern above, so `Number` cannot meet anything else.
    let removing = Number(hunk[1] ?? "1");
    let adding = Number(hunk[3] ?? "1");
    let number = Number(hunk[2]);
    while ((removing > 0 || adding > 0) && i < lines.length) {
      const line = lines[i] ?? "";
      i += 1;
      if (line.startsWith("\\")) continue;
      if (line.startsWith("+")) {
        added.push({ line: number, text: line.slice(1) });
        number += 1;
        adding -= 1;
      } else if (line.startsWith("-")) {
        removing -= 1;
      } else {
        number += 1;
        adding -= 1;
        removing -= 1;
      }
    }
  }
  return added;
}

/** Each kind of coercion BD-2 names, as a pattern over one line of source. */
export const KINDS: ReadonlyArray<readonly [string, RegExp]> = [
  ["as-cast", /\bas\s+(?!const\b)[A-Za-z_$({[]/],
  ["as-unknown-as", /\bas\s+unknown\s+as\b/],
  ["angle-cast", /(?:^|[=(,:?\s])<[A-Z][\w$.<>, ]*>\s*[\w$(]/],
  ["non-null", /[\w)\]]!(?=[.[)\],;\s]|$)/],
  ["definite-assignment", /[\w$]!\s*:/],
  ["any", /(?:[:<,|&=]\s*|\bas\s+)any\b/],
  ["Number()", /\bNumber\(/],
  ["String()", /\bString\(/],
  ["Boolean()", /\bBoolean\(/],
  ["parseInt/parseFloat", /\bparse(?:Int|Float)\(/],
  ["double-negation", /!!\s*[\w(]/],
  ["unary-plus", /(?:^|[=(,:?\s[]|\$\{)\+(?=[A-Za-z_$(])/],
  ["ts-comment", /@ts-(?:ignore|expect-error|nocheck)/],
  ["JSON.parse", /\bJSON\.parse\(/],
  ["Object.assign", /\bObject\.assign\(/],
  ["type-predicate", /\)\s*:\s*(?:asserts\s+)?[\w$]+\s+is\s+[\w$]/],
  ["sql-cast", /\bcast\s*\(|::\s*[a-z]/i],
];

/** A comment line, or an import or re-export, where `as` and `!` are not coercions. */
const NOT_CODE = /^\s*(?:\/\/|\/\*|\*|import\b|export\s+(?:\*|\{[^}]*\}\s+from)\b)/;

export function findCoercions(text: string): readonly string[] {
  if (NOT_CODE.test(text)) return [];
  return KINDS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}

function git(args: readonly string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
    maxBuffer: 64 * 1024 * 1024,
  });
}

const SOURCE = /\.(?:[cm]?ts|tsx|sql)$/;

/**
 * Every source file changed since `from`, as `[name, diff]`. An untracked file is diffed against
 * nothing, so all its lines count as added.
 */
function changes(from: string): ReadonlyArray<readonly [string, string]> {
  const diffArgs = ["--text", "--no-color", "--no-ext-diff", "-U0"];
  const tracked = git(["diff", "--name-only", "-z", "--diff-filter=ACMR", from, "--"])
    .split("\0")
    .filter((name) => SOURCE.test(name))
    .map((name) => [name, git(["diff", ...diffArgs, from, "--", name])] as const);
  const untracked = git(["ls-files", "-z", "--others", "--exclude-standard"])
    .split("\0")
    .filter((name) => SOURCE.test(name))
    .map(
      (name) =>
        [
          name,
          gitAllowingDifference(["diff", ...diffArgs, "--no-index", "/dev/null", name]),
        ] as const,
    );
  return [...tracked, ...untracked];
}

/** `git diff --no-index` exits 1 when the files differ, which here is the expected outcome. */
function gitAllowingDifference(args: readonly string[]): string {
  try {
    return git(args);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "status" in error && error.status === 1) {
      return "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
    }
    throw error;
  }
}

if (import.meta.main) {
  const base = process.argv[2] ?? "origin/main";
  let changed: ReadonlyArray<readonly [string, string]>;
  try {
    process.chdir(git(["rev-parse", "--show-toplevel"]).trim());
    // The merge-base, not the tip of `base`: lines `base` removed since the branch point would
    // otherwise show as added here.
    const from = git(["merge-base", base, "HEAD"]).trim();
    changed = changes(from);
  } catch {
    console.error(`coercions: could not diff against ${base}`);
    process.exit(2);
  }
  let found = 0;
  for (const [name, diff] of changed) {
    for (const { line, text } of addedLines(diff)) {
      const kinds = findCoercions(text);
      if (kinds.length === 0) continue;
      found += 1;
      console.log(`${name}:${String(line)}: ${kinds.join(", ")}: ${text.trim()}`);
    }
  }
  console.error(
    `coercions: ${String(found)} line(s) to judge in ${String(changed.length)} file(s)`,
  );
  process.exit(found === 0 ? 0 : 3);
}
