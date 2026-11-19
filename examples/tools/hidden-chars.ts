/**
 * Finds literal hidden characters in tracked text files, and can rewrite them as escapes (CD-7).
 * An agent's edits travel as JSON, so an escape typed into an edit lands as the character itself,
 * invisible in review.
 *
 *   node tools/hidden-chars.ts          list them (exit 3 if any, 0 if none, 2 if it cannot run)
 *   node tools/hidden-chars.ts --fix    rewrite each as a `\u` escape, then list what is left
 *
 * `--fix` writes the escape wherever the character is; that is right inside a string, regex or
 * comment, and a syntax error elsewhere, so review the diff it makes.
 *
 * Every listed file is read, whatever its name: a host script with no extension runs outside every
 * container, with the developer's credentials (TC-9). A file holding a NUL byte is binary and is
 * passed over; one that has none but is not UTF-8 cannot be judged, so it is a finding. Only regular
 * files are read, and none reached through a symlink, so `--fix` never writes outside the tree.
 */
import { execFileSync } from "node:child_process";
import { isUtf8 } from "node:buffer";
import { closeSync, constants, lstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * No-break and zero-width spaces, the soft hyphen, directional marks and embeddings (the "Trojan
 * Source" set, the Arabic letter mark among them), the Mongolian vowel separator, line and
 * paragraph separators, the word joiner, the byte-order mark, and the tag characters, which can
 * carry a whole hidden sentence past a reader to an agent that does read them.
 */
export const HIDDEN =
  /[\u00a0\u00ad\u061c\u180e\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/gu;

export interface Hit {
  readonly line: number;
  readonly codePoint: string;
}

/** Splits on `\n` only: `String.prototype.split` with a regex for all line ends would hide U+2028. */
export function findHidden(text: string): readonly Hit[] {
  const hits: Hit[] = [];
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(HIDDEN)) {
      const code = match[0].codePointAt(0) ?? 0;
      hits.push({
        line: index + 1,
        codePoint: `U+${code.toString(16).toUpperCase().padStart(4, "0")}`,
      });
    }
  });
  return hits;
}

/** Rewrites each hidden character as an escape: `\u` and four hex digits, or `\u{...}` above U+FFFF. */
export function escapeHidden(text: string): string {
  return text.replace(HIDDEN, (ch) => {
    const hex = (ch.codePointAt(0) ?? 0).toString(16);
    return hex.length > 4 ? `\\u{${hex}}` : `\\u${hex.padStart(4, "0")}`;
  });
}

/** What one listed path holds: text to judge, bytes that are not UTF-8, or nothing to judge. */
export type Listed =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "not-utf8" }
  | { readonly kind: "skip" };

/**
 * Reads a path git listed, relative to the current directory. Skipped: a path that is gone, is not
 * a regular file (a symlink, or a nested repository listed as `name/`), or has a symlink among its
 * directories (a tracked file whose directory was later replaced by a link), and a binary file.
 */
export function readListed(file: string): Listed {
  const parts = file.split("/").filter((part) => part !== "");
  for (let depth = 1; depth <= parts.length; depth += 1) {
    const stat = lstatSync(path.join(...parts.slice(0, depth)), { throwIfNoEntry: false });
    if (stat === undefined) return { kind: "skip" };
    if (depth < parts.length ? stat.isSymbolicLink() : !stat.isFile()) return { kind: "skip" };
  }
  const bytes = readFileSync(file);
  if (bytes.includes(0)) return { kind: "skip" };
  if (!isUtf8(bytes)) return { kind: "not-utf8" };
  return { kind: "text", text: bytes.toString("utf8") };
}

if (import.meta.main) {
  const fix = process.argv.includes("--fix");
  let files: string[];
  try {
    // From the repository's top, so the whole repository is scanned wherever this is run from.
    process.chdir(
      execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
    );
    files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
    })
      .split("\0")
      .filter((name) => name !== "");
  } catch {
    console.error("hidden-chars: could not list files with git");
    process.exit(2);
  }
  let total = 0;
  for (const file of files) {
    const listed = readListed(file);
    if (listed.kind === "skip") continue;
    if (listed.kind === "not-utf8") {
      total += 1;
      console.log(`${file}: not UTF-8, so it cannot be judged`);
      continue;
    }
    let { text } = listed;
    if (fix && findHidden(text).length > 0) {
      text = escapeHidden(text);
      // No following a link swapped in since the read.
      const fd = openSync(file, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
      try {
        writeFileSync(fd, text);
      } finally {
        closeSync(fd);
      }
    }
    for (const hit of findHidden(text)) {
      total += 1;
      console.log(`${file}:${String(hit.line)}: literal ${hit.codePoint}`);
    }
  }
  process.exit(total === 0 ? 0 : 3);
}
