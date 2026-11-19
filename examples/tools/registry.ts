/**
 * Judges every version in the lockfile against the registry's own record of it (TC-4).
 *
 * - Published more recently than `.npmrc`'s `min-release-age`: npm applies the age only to
 *   versions it resolves anew, so a fix command, a hand-edited lockfile or a version locked before
 *   the setting existed all pass it; the publish dates are the evidence.
 * - Resolved from anything but the registry's own tarball for that entry's name and version. A
 *   git or other URL has no publish date to judge (TC-4's `allow-git=none`), and a registry URL
 *   for another version or package would be installed while this one's date was judged.
 * - Deprecated, either the locked version itself or the package as a whole (its latest version):
 *   the maintainer's own word that it should not be used.
 *
 *   node tools/registry.ts    exit 0 clean, 3 findings, 2 the check itself could not run
 */
import { readFileSync } from "node:fs";

const REGISTRY = "https://registry.npmjs.org/";
const DAY_MS = 24 * 60 * 60 * 1000;

/** The one URL the registry serves `name`@`version` from: a scoped tarball drops the scope. */
export function tarball(name: string, version: string): string {
  return `${REGISTRY}${name}/-/${name.split("/").at(-1) ?? name}-${version}.tgz`;
}

export interface Locked {
  readonly name: string;
  readonly version: string;
  readonly resolved: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `min-release-age` from `.npmrc`, in days. Matched as digits before converting: `Number("")` is
 * 0, which would pass every version (BD-1).
 */
export function readMinAge(npmrc: string): number | undefined {
  for (const line of npmrc.split("\n")) {
    const match = /^\s*min-release-age\s*=\s*(\d+)\s*$/.exec(line);
    if (match?.[1] !== undefined) {
      const days = Number(match[1]);
      return days > 0 ? days : undefined;
    }
  }
  return undefined;
}

/** Every installed entry of a v3 `package-lock.json`; `undefined` when it cannot be read. */
export function readLockfile(text: string): readonly Locked[] | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(raw) || raw["lockfileVersion"] !== 3 || !isRecord(raw["packages"])) {
    return undefined;
  }
  const locked: Locked[] = [];
  for (const [key, entry] of Object.entries(raw["packages"])) {
    // The root is the project itself; a link is a workspace, not something fetched.
    if (key === "") continue;
    if (!isRecord(entry)) return undefined;
    if (entry["link"] === true) continue;
    const name = key.split("node_modules/").at(-1);
    const { version, resolved } = entry;
    if (name === undefined || name === "" || typeof version !== "string") return undefined;
    locked.push({ name, version, resolved: typeof resolved === "string" ? resolved : "" });
  }
  return locked;
}

/** What the registry says about one package, cut to what the judgements read. */
export interface RegistryRecord {
  /** The registry's `time` object: version → ISO date. */
  readonly time: Readonly<Record<string, unknown>>;
  /** Each deprecated version's message. */
  readonly deprecated: ReadonlyMap<string, string>;
  /** The `latest` dist-tag, if there is one. */
  readonly latest: string | undefined;
}

/** A registry document read into a `RegistryRecord`, or `undefined` if it is not one. */
export function readRecord(body: unknown): RegistryRecord | undefined {
  if (!isRecord(body) || !isRecord(body["time"]) || !isRecord(body["versions"])) return undefined;
  const deprecated = new Map<string, string>();
  for (const [version, manifest] of Object.entries(body["versions"])) {
    if (!isRecord(manifest)) return undefined;
    const message = manifest["deprecated"];
    // npm un-deprecates a version by setting its message to "".
    if (typeof message === "string" && message !== "") deprecated.set(version, message);
    else if (message !== undefined && typeof message !== "string") return undefined;
  }
  const tags = body["dist-tags"];
  const latest = isRecord(tags) && typeof tags["latest"] === "string" ? tags["latest"] : undefined;
  return { time: body["time"], deprecated, latest };
}

/** Outside text, shown quoted and cut short so it can neither run on nor carry control codes. */
function quote(text: string): string {
  return JSON.stringify(text.length > 160 ? `${text.slice(0, 160)}...` : text);
}

/**
 * Each locked version that is deprecated, or whose package is: its latest version is deprecated.
 * A version missing from `records` is judged by `judgeAges`, which refuses it.
 */
export function judgeDeprecation(
  locked: readonly Locked[],
  records: ReadonlyMap<string, RegistryRecord>,
): readonly string[] {
  const problems: string[] = [];
  for (const { name, version } of locked) {
    const record = records.get(name);
    if (record === undefined) continue;
    const own = record.deprecated.get(version);
    const whole = record.latest === undefined ? undefined : record.deprecated.get(record.latest);
    if (own !== undefined) {
      problems.push(`${name}@${version}: deprecated: ${quote(own)}`);
    } else if (whole !== undefined) {
      problems.push(
        `${name}@${version}: the package is deprecated (its latest, ${String(record.latest)}): ` +
          quote(whole),
      );
    }
  }
  return problems;
}

/**
 * Each locked version that is too new, has no publish date, or came from anything but its tarball.
 * `times` maps a package name to the registry's `time` object (version → ISO date).
 */
export function judgeAges(
  locked: readonly Locked[],
  times: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  now: Date,
  minDays: number,
): readonly string[] {
  const problems: string[] = [];
  for (const { name, version, resolved } of locked) {
    const label = `${name}@${version}`;
    if (resolved !== tarball(name, version)) {
      problems.push(
        `${label}: resolved from ${resolved === "" ? "nowhere" : resolved}, not the registry's ` +
          `tarball for it`,
      );
      continue;
    }
    const published = times.get(name)?.[version];
    const at = typeof published === "string" ? Date.parse(published) : Number.NaN;
    if (Number.isNaN(at)) {
      problems.push(`${label}: the registry gives no publish date`);
      continue;
    }
    const days = (now.getTime() - at) / DAY_MS;
    if (days < minDays) {
      const when = new Date(at).toISOString().slice(0, 10);
      problems.push(`${label}: published ${when}, under min-release-age (${String(minDays)} days)`);
    }
  }
  return problems;
}

function fail(message: string): never {
  console.error(`registry: ${message}`);
  process.exit(2);
}

/** The registry's record of one package, or a reason it could not be read. */
async function fetchRecord(name: string): Promise<RegistryRecord | string> {
  try {
    const response = await fetch(`${REGISTRY}${name.replace("/", "%2f")}`, {
      headers: { accept: "application/json" },
      // A deadline per request (SV-20), so a stalled registry fails the check rather than hang it.
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) return `HTTP ${String(response.status)}`;
    const body: unknown = await response.json();
    return readRecord(body) ?? "not a package document";
  } catch (error) {
    return error instanceof Error ? error.name : "unknown error";
  }
}

if (import.meta.main) {
  let npmrc: string;
  let lockText: string;
  try {
    npmrc = readFileSync(".npmrc", "utf8");
    lockText = readFileSync("package-lock.json", "utf8");
  } catch {
    fail("cannot read .npmrc or package-lock.json");
  }
  const minDays = readMinAge(npmrc);
  if (minDays === undefined) fail(".npmrc sets no min-release-age of at least one day");
  const locked = readLockfile(lockText);
  if (locked === undefined) fail("package-lock.json is not a lockfile this check can read");
  if (locked.length === 0) fail("package-lock.json lists no packages");

  const names = [...new Set(locked.map((entry) => entry.name))];
  const records = new Map<string, RegistryRecord>();
  // A few at a time: the registry is shared, and one package's document can run to 20 MB.
  for (let i = 0; i < names.length; i += 8) {
    const batch = names.slice(i, i + 8);
    const results = await Promise.all(batch.map(fetchRecord));
    results.forEach((result, j) => {
      const name = batch[j] ?? "";
      if (typeof result === "string") fail(`could not read ${name} from the registry (${result})`);
      records.set(name, result);
    });
  }
  const times = new Map([...records].map(([name, record]) => [name, record.time]));
  const problems = [
    ...judgeAges(locked, times, new Date(), minDays),
    ...judgeDeprecation(locked, records),
  ];
  for (const problem of problems) console.log(problem);
  process.exit(problems.length === 0 ? 0 : 3);
}
