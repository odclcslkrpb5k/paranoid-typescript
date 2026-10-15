/**
 * A ratchet for compiler errors (AD-2): `tsc` has no suppressions of its own, so the errors a
 * codebase already has are recorded per file and error code in `tsc-baseline.json`, and the count
 * may only go down.
 *
 *   node tools/tsc-baseline.ts record          write tsc-baseline.json from the current errors
 *   node tools/tsc-baseline.ts check [<ref>]   check the current errors and the baseline
 *
 * `check` reads two baselines: the one committed at `<ref>` (default `origin/main`) and the one in
 * the working tree. The working tree's may not allow more than `<ref>`'s anywhere, so one change
 * cannot raise its own allowance; the current errors may not exceed the working tree's; and the
 * working tree's may not exceed the current errors, so a change that fixes errors records it.
 * Exit status: 0 clean, 3 findings, 2 the check itself could not run.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** `file\tTS1234` → count. Errors with no file location use the file `(global)`. */
export type Counts = ReadonlyMap<string, number>;

const LOCATED = /^(.+?)\(\d+,\d+\): error (TS\d+):/;
const GLOBAL = /^error (TS\d+):/;
const BASELINE = "tsc-baseline.json";

/** Counts errors in `tsc --pretty false` output by file and code. */
export function parseTscOutput(output: string): Counts {
  const counts = new Map<string, number>();
  for (const line of output.split("\n")) {
    const located = LOCATED.exec(line);
    const global = located === null ? GLOBAL.exec(line) : null;
    const file = located?.[1] ?? (global === null ? undefined : "(global)");
    const code = located?.[2] ?? global?.[1];
    if (file === undefined || code === undefined) continue;
    const key = `${file}\t${code}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Each key whose value exceeds its limit, as `key: limit -> value`. */
function exceeding(values: Counts, limits: Counts): string[] {
  return [...values]
    .filter(([key, n]) => n > (limits.get(key) ?? 0))
    .map(([key, n]) => `${key}: ${String(limits.get(key) ?? 0)} -> ${String(n)}`);
}

export interface Decision {
  /** The working tree's baseline allows more than the base's. */
  readonly raised: readonly string[];
  /** Current errors above the working tree's baseline, including keys it does not have. */
  readonly rising: readonly string[];
  /** Baseline entries above the current errors: fixed, but not yet recorded. */
  readonly stale: readonly string[];
}

/**
 * `base` is the baseline committed at the reference, or `undefined` where the reference has none:
 * then the working tree's baseline is the first one, and is judged by review rather than here.
 */
export function decide(current: Counts, tree: Counts, base: Counts | undefined): Decision {
  return {
    raised: base === undefined ? [] : exceeding(tree, base),
    rising: exceeding(current, tree),
    stale: exceeding(tree, current),
  };
}

export function serialize(counts: Counts): string {
  const sorted = Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `${JSON.stringify({ version: 1, counts: sorted }, null, 2)}\n`;
}

export function deserialize(text: string): Counts | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null || !("version" in raw) || raw.version !== 1) {
    return undefined;
  }
  if (!("counts" in raw) || typeof raw.counts !== "object" || raw.counts === null) return undefined;
  const counts = new Map<string, number>();
  for (const [key, n] of Object.entries(raw.counts)) {
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) return undefined;
    counts.set(key, n);
  }
  return counts;
}

function fail(message: string): never {
  console.error(`tsc-baseline: ${message}`);
  process.exit(2);
}

/**
 * Runs `tsc` and counts its errors. Any sign the output is incomplete — a spawn error, a signal,
 * output past the buffer, a failure with nothing readable — stops the check rather than letting a
 * partial count stand for the whole.
 */
function runTsc(): Counts {
  const run = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (run.error !== undefined) fail(`could not run tsc (${run.error.name})`);
  if (run.signal !== null) fail(`tsc was stopped by ${run.signal}`);
  const counts = parseTscOutput(run.stdout);
  if (run.status !== 0 && counts.size === 0) fail("tsc failed and printed no error it could read");
  return counts;
}

function git(args: readonly string[]): { readonly ok: boolean; readonly out: string } {
  const run = spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return { ok: run.error === undefined && run.status === 0, out: run.stdout };
}

function readBaseAt(ref: string): Counts | undefined {
  if (!git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).ok) {
    fail(`the reference ${ref} does not exist here (a shallow checkout, or no remote?)`);
  }
  const path = `${ref}:./${BASELINE}`;
  if (!git(["cat-file", "-e", path]).ok) return undefined;
  const parsed = deserialize(git(["show", path]).out);
  return parsed ?? fail(`the baseline at ${ref} is not a valid baseline file`);
}

if (import.meta.main) {
  const [mode, ref = "origin/main"] = process.argv.slice(2);
  if (mode !== "record" && mode !== "check") fail("usage: record | check [<ref>]");
  const current = runTsc();
  if (mode === "record") {
    writeFileSync(BASELINE, serialize(current));
    console.log(`tsc-baseline: recorded ${String(current.size)} file and code pairs`);
    process.exit(0);
  }
  const base = readBaseAt(ref);
  const tree = existsSync(BASELINE)
    ? (deserialize(readFileSync(BASELINE, "utf8")) ?? fail(`${BASELINE} is not a valid file`))
    : new Map<string, number>();
  const { raised, rising, stale } = decide(current, tree, base);
  for (const line of raised) console.error(`raised  ${line} (the baseline may only shrink)`);
  for (const line of rising) console.error(`rising  ${line}`);
  for (const line of stale)
    console.error(`stale   ${line} (run record and commit the smaller file)`);
  // A commit hash, so the report says which base was judged, even after the ref has moved.
  const judged = execFileSync("git", ["rev-parse", "--short", ref], { encoding: "utf8" }).trim();
  console.error(`tsc-baseline: judged against ${ref} (${judged})`);
  process.exit(raised.length + rising.length + stale.length === 0 ? 0 : 3);
}
