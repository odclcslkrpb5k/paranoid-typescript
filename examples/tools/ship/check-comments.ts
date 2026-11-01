/**
 * Refuses code comments that narrate a change instead of explaining the code (CD-1).
 *
 * A narrating comment describes a defect nobody can observe a month later. This catches the
 * unambiguous tells mechanically. It cannot judge whether a comment will stay true and useful; that
 * re-read is still required.
 *
 * The tells are phrases about the code's own history, not single words: durable comments use words
 * like "was" and "now" constantly, about data rather than code, and a check that blocks them teaches
 * everyone to bypass it. The repository's own comments are the calibration: the gate scans them,
 * so they must keep passing whenever a tell is added.
 *
 * Git runs outside, in `tools/ship/comments_check.sh`, which hands each file over on stdin as `name NUL diff NUL`: names travel outside the diff because
 * diff headers quote unusual names and follow the user's prefix settings.
 *
 * Usage: node tools/ship/check-comments.ts < (name NUL diff NUL)...
 * Exit:  0 none found, 3 a narrating comment found (listed on stderr).
 */
import { readFileSync } from "node:fs";

export interface Finding {
  readonly file: string;
  readonly comment: string;
  readonly tell: string;
}

const TELLS: readonly RegExp[] = [
  /\bformerly\b/i,
  /\banymore\b/i,
  /(?<=^|[.;:]\s*)this (?:fix|fixes|fixed)\b/i,
  /\bthis (?:commit|pr)\b/i,
  /\bfix(?:es|ed)? (?:the|a|an) (?:bug|issue|regression|problem)\b/i,
  /\bwe (?:now|no longer|changed|switched|replaced|removed)\b/i,
  /\bpreviously (?:returned|called|used|read|wrote|lived|took|handled|did)\b/i,
  /\bused to be (?:called|named)\b/i,
  /\bno longer (?:needed|necessary|required|used)\b/i,
  /\bnow (?:uses|returns|handles|reads|writes|lives|takes|calls)\b/i,
  /\bthe old (?:code|behaviou?r|version|implementation|approach)\b/i,
];

const SLASH = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "css"]);
const HASH = new Set(["sh", "bash", "py", "yml", "yaml", "toml"]);

type Style = "slash" | "sql" | "hash";

const OPENERS: Readonly<
  Record<Style, { readonly tokens: readonly string[]; readonly after: RegExp }>
> = {
  slash: { tokens: ["//", "/*"], after: /[\s{;]/ },
  sql: { tokens: ["--", "/*"], after: /\s/ },
  hash: { tokens: ["#"], after: /\s/ },
};

/**
 * The comment syntax of a path, or null for one not judged: prose (Markdown, `docs/`), data, and
 * `vendor/`, whose bytes are upstream's and checked against their manifest instead (RP-4); a
 * refusal there could only be met by editing them.
 */
function style(path: string): Style | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (path.startsWith("vendor/") || path.startsWith("docs/") || name.endsWith(".md")) return null;
  const dot = name.lastIndexOf(".");
  // Extensionless files here are shell scripts, git hooks, Dockerfiles and line-based lists.
  if (dot <= 0) return "hash";
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === "sql") return "sql";
  if (SLASH.has(ext)) return "slash";
  if (HASH.has(ext)) return "hash";
  return null;
}

/** The comment on a line of `path`, or null when the line carries none or the file is exempt. */
export function commentText(path: string, line: string): string | null {
  const kind = style(path);
  if (kind === null) return null;
  if (kind === "slash") {
    const continuation = /^\s*\*(?!\/)(.*)$/.exec(line);
    if (continuation !== null) return (continuation[1] ?? "").trim();
  }
  const { tokens, after } = OPENERS[kind];
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (quote !== null) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
    } else if (i === 0 || after.test(line.charAt(i - 1))) {
      const token = tokens.find((t) => line.startsWith(t, i));
      if (token !== undefined && !line.startsWith("#!", i)) {
        return line.slice(i + token.length).trim();
      }
    }
  }
  return null;
}

export function narration(path: string, lines: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (const line of lines) {
    const comment = commentText(path, line);
    if (comment === null) continue;
    for (const tell of TELLS) {
      const match = tell.exec(comment);
      if (match !== null) {
        findings.push({ file: path, comment, tell: match[0] });
        break;
      }
    }
  }
  return findings;
}

/** The added lines of one file's `git diff -U0`, in order. Header lines are not content. */
export function addedInHunks(diff: string): string[] {
  const added: string[] = [];
  let inHunks = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) inHunks = true;
    else if (inHunks && line.startsWith("+")) added.push(line.slice(1));
  }
  return added;
}

/** Every finding in the input comments_check.sh hands over: `name NUL diff NUL`, repeated. */
export function judgeStaged(input: string): Finding[] {
  const parts = input.split("\0");
  const findings: Finding[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    findings.push(...narration(parts[i] ?? "", addedInHunks(parts[i + 1] ?? "")));
  }
  return findings;
}

export function report(findings: readonly Finding[]): string {
  return [
    "CD-1: these comments narrate a change instead of explaining the code:",
    ...findings.map((f) => `  ${f.file}: "${f.tell}" in: ${f.comment}`),
    "State the durable reason, put the history in the commit body, or delete the comment.",
  ].join("\n");
}

if (import.meta.main) {
  const findings = judgeStaged(readFileSync(0, "utf8"));
  if (findings.length > 0) {
    console.error(report(findings));
    process.exit(3);
  }
}
