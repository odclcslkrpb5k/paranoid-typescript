/**
 * Refuses added lines that carry a secret with no recognisable shape (SH-12): a value whose SHA-256
 * is listed in `tools/secret-hashes.txt`, which holds digests and never a value. The shapes - vendor
 * and project tokens, keys, passwords - are `tools/ship/secrets_check.sh`'s, which runs this through
 * `tools/ship/run-node` once a list holds a digest, with the base's list merged with the tree's.
 * Prints a count, never a value.
 *
 * Usage: node tools/ship/check-secret-hashes.ts < <hash list> NUL <added lines>
 * Exit:  0 none found, 3 a listed value found, 2 the input is not a list and lines split by a NUL.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** What a hashed value is looked for in: hex, a UUID, base64url. */
const TOKEN_RUN = /[A-Za-z0-9_-]{12,}/g;
const SHORTEST = 12;

/**
 * A GUID wherever it sits - after `%3D` in an encoded query, with letters joined to it, without its
 * dashes - which the run boundaries would cut wrongly; normalized to its dashed lower-case form.
 */
const GUID = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi;

export function guids(line: string): string[] {
  return [...line.matchAll(GUID)].map(([m]) => {
    const hex = m.replace(/-/g, "").toLowerCase();
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  });
}

/**
 * Every span of a run between `-` and `_` boundaries, lower-cased: `${VAR:-<value>}` and
 * `dump-<value>.sql` hold the value as part of a longer run, and a GUID is written in either case.
 */
export function candidates(run: string): string[] {
  const parts = run.toLowerCase().split(/(?=[-_])|(?<=[-_])/);
  const found = new Set<string>();
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j <= parts.length; j++) {
      const span = parts.slice(i, j).join("");
      if (span.length >= SHORTEST && !/^[-_]|[-_]$/.test(span)) found.add(span);
    }
  }
  return [...found];
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The digests in a hash list: one per line, `#` starting a note. */
export function parseHashes(text: string): Set<string> {
  return new Set(
    text
      .split("\n")
      .map((line) => line.replace(/#.*/, "").trim().toLowerCase())
      .filter((line) => /^[0-9a-f]{64}$/.test(line)),
  );
}

/** How many of the lines carry a value whose digest is listed. */
export function linesWithKnown(lines: readonly string[], known: ReadonlySet<string>): number {
  let count = 0;
  for (const line of lines) {
    const looked = new Set([
      ...[...line.matchAll(TOKEN_RUN)].flatMap(([run]) => candidates(run)),
      ...guids(line),
    ]);
    for (const candidate of looked) {
      if (known.has(sha256(candidate))) {
        count++;
        break;
      }
    }
  }
  return count;
}

/** The exit status for a hash list and the added lines; the status is all secrets_check.sh reads. */
export function judge(
  listText: string,
  input: string,
  report: (line: string) => void = console.log,
): number {
  const found = linesWithKnown(input.split("\n"), parseHashes(listText));
  if (found === 0) return 0;
  report(`known secret value: ${String(found)} added line(s)`);
  return 3;
}

if (import.meta.main) {
  const raw = readFileSync(0);
  const cut = raw.indexOf(0);
  if (cut < 0) {
    console.error("usage: check-secret-hashes.ts < <hash list> NUL <added lines>");
    process.exit(2);
  }
  process.exit(
    judge(raw.subarray(0, cut).toString("utf8"), raw.subarray(cut + 1).toString("utf8")),
  );
}
