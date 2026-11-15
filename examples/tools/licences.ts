/**
 * Fails on any locked package whose licence the project has not allowed (TC-11). The allowed
 * licences are one committed file, `licence-allow-list.json`; every package in the lockfile is
 * judged, development tools included, and each licence is read twice: from the lockfile, and from
 * the installed package's own manifest, which must agree.
 *
 *   node tools/licences.ts    exit 0 clean, 3 findings, 2 the check itself could not run
 *
 * A licence is an SPDX expression. `OR` passes when either side is allowed, `AND` only when both
 * are, and `X WITH Y` only when that whole text is allowed. Anything that is not an expression
 * ("SEE LICENSE IN ...", `UNLICENSED`, an old `{ "type": ... }` object, nothing) is a finding. An
 * allowed licence no package uses is a finding too, so the list never grows wider than the tree.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const ALLOW_LIST = "licence-allow-list.json";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type Licence =
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "and" | "or"; readonly left: Licence; readonly right: Licence };

const TOKEN = /\s*(\(|\)|[A-Za-z0-9.+:-]+)/y;
const ID = /^[A-Za-z0-9.+:-]+$/;
const OPERATORS = new Set(["AND", "OR", "WITH"]);

function tokenize(text: string): readonly string[] | undefined {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    if (/^\s*$/.test(text.slice(TOKEN.lastIndex))) break;
    const match = TOKEN.exec(text);
    if (match?.[1] === undefined) return undefined;
    tokens.push(match[1]);
  }
  return tokens;
}

/** An SPDX licence expression, or `undefined` for anything that is not one. */
export function parseLicence(text: string): Licence | undefined {
  const tokens = tokenize(text);
  if (tokens === undefined || tokens.length === 0) return undefined;
  let at = 0;
  const peek = (): string | undefined => tokens[at];

  function atom(): Licence | undefined {
    const token = peek();
    if (token === "(") {
      at += 1;
      const inner = or();
      if (inner === undefined || peek() !== ")") return undefined;
      at += 1;
      return inner;
    }
    if (token === undefined || token === ")" || OPERATORS.has(token) || !ID.test(token)) {
      return undefined;
    }
    at += 1;
    if (peek() !== "WITH") return { kind: "id", id: token };
    at += 1;
    const exception = peek();
    if (exception === undefined || OPERATORS.has(exception) || !ID.test(exception)) {
      return undefined;
    }
    at += 1;
    return { kind: "id", id: `${token} WITH ${exception}` };
  }

  function chain(kind: "and" | "or", word: string, next: () => Licence | undefined) {
    return (): Licence | undefined => {
      let left = next();
      while (left !== undefined && peek() === word) {
        at += 1;
        const right = next();
        if (right === undefined) return undefined;
        left = { kind, left, right };
      }
      return left;
    };
  }
  const and = chain("and", "AND", atom);
  const or = chain("or", "OR", and);

  const licence = or();
  return licence !== undefined && at === tokens.length ? licence : undefined;
}

/** Whether a licence is allowed, and which allowed identifiers it relied on. */
export function allows(licence: Licence, allowed: ReadonlySet<string>): readonly string[] | false {
  switch (licence.kind) {
    case "id":
      return allowed.has(licence.id) ? [licence.id] : false;
    case "and": {
      const left = allows(licence.left, allowed);
      const right = allows(licence.right, allowed);
      return left === false || right === false ? false : [...left, ...right];
    }
    case "or": {
      const left = allows(licence.left, allowed);
      return left === false ? allows(licence.right, allowed) : left;
    }
  }
}

/** Reads the allow-list: `{"version": 1, "allow": ["MIT", ...]}`, no entry twice. */
export function parseAllowList(text: string): ReadonlySet<string> | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return `${ALLOW_LIST} is not JSON`;
  }
  if (!isRecord(raw) || raw["version"] !== 1 || !Array.isArray(raw["allow"])) {
    return `${ALLOW_LIST} is not {"version": 1, "allow": [...]}`;
  }
  const allowed = new Set<string>();
  for (const entry of raw["allow"]) {
    if (typeof entry !== "string" || parseLicence(entry)?.kind !== "id") {
      return `${ALLOW_LIST}: ${JSON.stringify(entry)} is not one licence identifier`;
    }
    if (allowed.has(entry)) return `${ALLOW_LIST}: ${entry} is listed twice`;
    allowed.add(entry);
  }
  return allowed;
}

export interface Package {
  /** The lockfile's key, `node_modules/...`. */
  readonly key: string;
  readonly version: string;
  /** The `license` member, as the lockfile records it. */
  readonly locked: unknown;
  /** The same member of the installed package's manifest. */
  readonly installed: unknown;
}

/** Every problem: per package, then per allowed licence that no package relies on. */
export function judgeLicences(
  packages: readonly Package[],
  allowed: ReadonlySet<string>,
): readonly string[] {
  const problems: string[] = [];
  const used = new Set<string>();
  for (const { key, version, locked, installed } of packages) {
    const label = `${key.split("node_modules/").at(-1) ?? key}@${version}`;
    if (typeof locked !== "string" || typeof installed !== "string" || locked !== installed) {
      problems.push(
        `${label}: the lockfile says ${JSON.stringify(locked)}, the installed manifest ` +
          `${JSON.stringify(installed)}; each must name the same licence`,
      );
      continue;
    }
    const licence = parseLicence(locked);
    if (licence === undefined) {
      problems.push(`${label}: "${locked}" is not an SPDX licence expression`);
      continue;
    }
    const relied = allows(licence, allowed);
    if (relied === false) {
      problems.push(`${label}: ${locked} is not allowed by ${ALLOW_LIST}`);
      continue;
    }
    for (const id of relied) used.add(id);
  }
  for (const id of allowed) {
    if (!used.has(id)) problems.push(`${ALLOW_LIST}: no package needs ${id}; delete it`);
  }
  return problems;
}

/** Every installed entry of a v3 lockfile, with both readings of its licence. */
function readPackages(lockText: string, root: string): readonly Package[] | string {
  let raw: unknown;
  try {
    raw = JSON.parse(lockText);
  } catch {
    return "package-lock.json is not JSON";
  }
  if (!isRecord(raw) || raw["lockfileVersion"] !== 3 || !isRecord(raw["packages"])) {
    return "package-lock.json is not a v3 lockfile";
  }
  const packages: Package[] = [];
  for (const [key, entry] of Object.entries(raw["packages"])) {
    if (key === "") continue;
    if (!isRecord(entry) || typeof entry["version"] !== "string") return `${key}: no version`;
    if (entry["link"] === true) continue;
    let manifest: unknown;
    try {
      manifest = JSON.parse(readFileSync(path.join(root, key, "package.json"), "utf8"));
    } catch {
      return `${key} is not installed; run npm ci first`;
    }
    if (!isRecord(manifest) || manifest["version"] !== entry["version"]) {
      return `${key}: the installed version is not the locked one; run npm ci first`;
    }
    packages.push({
      key,
      version: entry["version"],
      locked: entry["license"],
      installed: manifest["license"],
    });
  }
  return packages;
}

function fail(message: string): never {
  console.error(`licences: ${message}`);
  process.exit(2);
}

if (import.meta.main) {
  let allowText: string;
  let lockText: string;
  try {
    allowText = readFileSync(ALLOW_LIST, "utf8");
    lockText = readFileSync("package-lock.json", "utf8");
  } catch {
    fail(`cannot read ${ALLOW_LIST} or package-lock.json`);
  }
  const allowed = parseAllowList(allowText);
  if (typeof allowed === "string") fail(allowed);
  const packages = readPackages(lockText, process.cwd());
  if (typeof packages === "string") fail(packages);
  if (packages.length === 0) fail("package-lock.json lists no packages");
  const problems = judgeLicences(packages, allowed);
  for (const problem of problems) console.log(problem);
  process.exit(problems.length === 0 ? 0 : 3);
}
