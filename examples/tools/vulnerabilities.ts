/**
 * Fails on any known vulnerability or malicious package in the lockfile that no live waiver covers
 * (TC-10). osv-scanner finds them; this judges its findings against `vulnerability-waivers.json`,
 * whose every entry names one advisory and one package, says why, and expires.
 *
 *   node tools/vulnerabilities.ts    exit 0 clean, 3 findings, 2 the check itself could not run
 *
 * The scanner runs with no ignore list of its own, so every waiver is judged here: one with no
 * date, a date past or too far ahead, one that matches nothing, and any waiver of a malicious
 * package are each refused. It needs the network; a scanner that cannot reach its database is a
 * check that did not run, never a clean one.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const WAIVERS = "vulnerability-waivers.json";
/** The longest a waiver may run: past this it is a decision not to fix, made without saying so. */
export const MAX_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Finding {
  readonly name: string;
  readonly version: string;
  /** Every identifier the advisory goes by: its own ids and their aliases. */
  readonly ids: readonly string[];
}

export interface Waiver {
  readonly id: string;
  readonly name: string;
  /** `YYYY-MM-DD`; the waiver stops counting on this day. */
  readonly until: string;
  readonly reason: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    out.push(item);
  }
  return out;
}

/**
 * Reads osv-scanner's `--format json` report, cut to what the judgement uses: each package's
 * name and version, and each group of advisories with all their names. Anything that does not fit
 * is `undefined`, never an empty list, since an empty list would read as a clean lockfile.
 */
export function parseReport(text: string): readonly Finding[] | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(raw) || !Array.isArray(raw["results"])) return undefined;
  const findings: Finding[] = [];
  for (const result of raw["results"]) {
    if (!isRecord(result) || !Array.isArray(result["packages"])) return undefined;
    for (const entry of result["packages"]) {
      if (!isRecord(entry) || !isRecord(entry["package"]) || !Array.isArray(entry["groups"])) {
        return undefined;
      }
      const { name, version } = entry["package"];
      if (typeof name !== "string" || typeof version !== "string") return undefined;
      for (const group of entry["groups"]) {
        if (!isRecord(group)) return undefined;
        const ids = strings(group["ids"]);
        const aliases = strings(group["aliases"]);
        if (ids === undefined || aliases === undefined || ids.length === 0) return undefined;
        findings.push({ name, version, ids: [...new Set([...ids, ...aliases])] });
      }
    }
  }
  return findings;
}

const ADVISORY = /^[A-Z]+-[A-Za-z0-9-]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` that names a real day: `2026-02-30` is refused, not rolled into March. */
function isDay(text: string): boolean {
  return DATE.test(text) && new Date(`${text}T00:00:00Z`).toISOString().startsWith(text);
}

/** Reads the waiver file. Problems are returned by entry, so one bad entry hides no other. */
export function parseWaivers(text: string): {
  readonly waivers: readonly Waiver[];
  readonly problems: readonly string[];
} {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { waivers: [], problems: [`${WAIVERS} is not JSON`] };
  }
  if (!isRecord(raw) || raw["version"] !== 1 || !Array.isArray(raw["waivers"])) {
    return { waivers: [], problems: [`${WAIVERS} is not {"version": 1, "waivers": [...]}`] };
  }
  const waivers: Waiver[] = [];
  const problems: string[] = [];
  raw["waivers"].forEach((entry: unknown, index) => {
    const at = `${WAIVERS} entry ${String(index + 1)}`;
    if (!isRecord(entry)) {
      problems.push(`${at} is not an object`);
      return;
    }
    const { id, name, until, reason } = entry;
    if (typeof id !== "string" || !ADVISORY.test(id)) problems.push(`${at}: no advisory id`);
    if (typeof name !== "string" || name === "") problems.push(`${at}: no package name`);
    if (typeof until !== "string" || !isDay(until)) {
      problems.push(`${at}: no "until" date (YYYY-MM-DD); every waiver expires`);
    }
    if (typeof reason !== "string" || reason.trim() === "") problems.push(`${at}: no reason`);
    if (
      typeof id === "string" &&
      ADVISORY.test(id) &&
      typeof name === "string" &&
      name !== "" &&
      typeof until === "string" &&
      isDay(until) &&
      typeof reason === "string" &&
      reason.trim() !== ""
    ) {
      waivers.push({ id, name, until, reason });
    }
  });
  return { waivers, problems };
}

function isMalicious(ids: readonly string[]): boolean {
  return ids.some((id) => id.startsWith("MAL-"));
}

/**
 * Every problem, by finding and by waiver. `today` is `YYYY-MM-DD` in UTC. A waiver covers a
 * finding when it names the same package and any one of the advisory's names.
 */
export function judge(
  findings: readonly Finding[],
  waivers: readonly Waiver[],
  today: string,
): readonly string[] {
  const problems: string[] = [];
  const latest = new Date(Date.parse(`${today}T00:00:00Z`) + MAX_DAYS * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const covers = (w: Waiver, f: Finding): boolean => w.name === f.name && f.ids.includes(w.id);
  for (const f of findings) {
    const label = `${f.name}@${f.version} ${f.ids.join(" / ")}`;
    if (isMalicious(f.ids)) {
      problems.push(`${label}: a malicious package; remove it, it cannot be waived`);
    } else if (!waivers.some((w) => covers(w, f) && w.until > today)) {
      problems.push(`${label}: no live waiver`);
    }
  }
  for (const w of waivers) {
    const label = `waiver ${w.id} for ${w.name}`;
    const matched = findings.filter((f) => covers(w, f));
    if (w.id.startsWith("MAL-") || matched.some((f) => isMalicious(f.ids))) {
      problems.push(`${label}: waives a malicious package`);
    }
    if (matched.length === 0) problems.push(`${label}: matches no finding; delete it`);
    if (w.until <= today) problems.push(`${label}: expired on ${w.until}`);
    if (w.until > latest) {
      problems.push(`${label}: runs to ${w.until}, past ${String(MAX_DAYS)} days from today`);
    }
  }
  return problems;
}

function fail(message: string): never {
  console.error(`vulnerabilities: ${message}`);
  process.exit(2);
}

if (import.meta.main) {
  let waiverText: string;
  try {
    waiverText = readFileSync(WAIVERS, "utf8");
  } catch {
    fail(`cannot read ${WAIVERS}`);
  }
  // The scanner's own deadline, so a hung database fetch fails the check rather than holding it.
  const run = spawnSync(
    "osv-scanner",
    ["scan", "source", "--format", "json", "--lockfile", "package-lock.json"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 300_000 },
  );
  if (run.error !== undefined) fail(`could not run osv-scanner (${run.error.name})`);
  if (run.signal !== null) fail(`osv-scanner was stopped by ${run.signal}`);
  // 0 is "nothing found" and 1 "findings"; anything else (127 when its database is unreachable,
  // though it still prints an empty summary) is a scan that did not happen.
  if (run.status !== 0 && run.status !== 1) {
    fail(`osv-scanner exited ${String(run.status)}:\n${run.stderr.trim()}`);
  }
  const findings = parseReport(run.stdout);
  if (findings === undefined) fail("osv-scanner's report could not be read");
  if ((run.status === 1) !== findings.length > 0) {
    fail(`osv-scanner exited ${String(run.status)} but reported ${String(findings.length)}`);
  }
  const { waivers, problems: malformed } = parseWaivers(waiverText);
  const problems = [
    ...malformed,
    ...judge(findings, waivers, new Date().toISOString().slice(0, 10)),
  ];
  for (const problem of problems) console.log(problem);
  process.exit(problems.length === 0 ? 0 : 3);
}
