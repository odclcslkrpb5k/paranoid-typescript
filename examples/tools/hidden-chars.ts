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
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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
      .filter((name) => /\.(?:[cm]?[jt]s|tsx|json|md|sql|ya?ml)$/.test(name));
  } catch {
    console.error("hidden-chars: could not list files with git");
    process.exit(2);
  }
  let total = 0;
  for (const file of files) {
    // A tracked file deleted in the working tree has nothing to scan.
    if (!existsSync(file)) continue;
    let text = readFileSync(file, "utf8");
    if (fix && findHidden(text).length > 0) {
      text = escapeHidden(text);
      writeFileSync(file, text);
    }
    for (const hit of findHidden(text)) {
      total += 1;
      console.log(`${file}:${String(hit.line)}: literal ${hit.codePoint}`);
    }
  }
  process.exit(total === 0 ? 0 : 3);
}
