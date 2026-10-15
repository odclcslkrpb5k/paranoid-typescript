/**
 * The lint configuration refuses what the standard says it refuses (LN-9), and nothing else in the
 * fixture. Findings are compared with the fixture's `// expect:` markers in both directions, so a
 * rule that stops firing and a rule that starts firing on innocent code both fail (TS-6).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ESLint } from "eslint";
import { isRecord } from "../src/records.ts";
import { must } from "./support/assert.ts";
import "./support/leaks.ts";

const root = path.dirname(import.meta.dirname);
const fixture = path.join(root, "test/fixtures/lint/violations.ts");

function expected(): string[] {
  return readFileSync(fixture, "utf8")
    .split("\n")
    .flatMap((line, index) => {
      const markers = /expect: ([@\w/, -]+?)\s*$/.exec(line)?.[1];
      if (markers === undefined) return [];
      return markers.split(",").map((rule) => `${String(index + 1)} ${rule.trim()}`);
    });
}

test("each marked violation draws its rule, and nothing else is reported", async () => {
  // The fixture directory is ignored by the normal lint run; here it is linted on purpose.
  const eslint = new ESLint({ cwd: root, ignore: false });
  const [result] = await eslint.lintFiles([fixture]);
  const actual = must(result, "the fixture's lint result")
    // A message with no rule id is ESLint's own report of an unused suppression comment, which
    // `reportUnusedDisableDirectives` makes an error, or a parse failure; the text tells which.
    .messages.map((m) => {
      const rule =
        m.ruleId ?? (m.message.startsWith("Unused eslint-disable") ? "unused-directive" : "fatal");
      return `${String(m.line)} ${rule}`;
    })
    .sort();
  const wanted = expected().sort();
  assert.ok(wanted.length >= 10, "the fixture has lost its markers");
  assert.deepEqual(actual, wanted);
});

/** The restricted-syntax selectors in force for a file, or `undefined` when the rule is off. */
async function selectorsFor(eslint: ESLint, file: string): Promise<readonly string[] | undefined> {
  const config: unknown = await eslint.calculateConfigForFile(path.join(root, file));
  assert.ok(isRecord(config) && isRecord(config["rules"]), `no rules for ${file}`);
  const setting: unknown = config["rules"]["no-restricted-syntax"];
  assert.ok(Array.isArray(setting), `no-restricted-syntax is not configured for ${file}`);
  // `Array.isArray` narrows to `any[]`; reading it as `unknown[]` keeps every entry checked.
  const list: readonly unknown[] = setting;
  const [severity, ...entries] = list;
  if (severity === 0 || severity === "off") return undefined;
  return entries.flatMap((entry: unknown) =>
    isRecord(entry) && typeof entry["selector"] === "string" ? [entry["selector"]] : [],
  );
}

/** Whether a rule is switched off for a file. */
async function isOff(eslint: ESLint, file: string, rule: string): Promise<boolean> {
  const config: unknown = await eslint.calculateConfigForFile(path.join(root, file));
  assert.ok(isRecord(config) && isRecord(config["rules"]));
  const setting: unknown = config["rules"][rule];
  const severity: unknown = Array.isArray(setting) ? setting[0] : setting;
  return severity === 0 || severity === "off";
}

test("each exemption reaches exactly the files it names", async () => {
  const eslint = new ESLint({ cwd: root });
  const domain = must(await selectorsFor(eslint, "src/ids.ts"), "domain selectors");
  assert.ok(domain.includes("ThrowStatement") && domain.some((s) => s.startsWith("CatchClause")));
  assert.equal(await isOff(eslint, "src/ids.ts", "no-restricted-imports"), false);

  const result = must(await selectorsFor(eslint, "src/result.ts"), "result.ts selectors");
  assert.ok(!result.includes("ThrowStatement"), "panic's module may throw");
  assert.ok(
    result.some((s) => s.startsWith("CatchClause")),
    "but nothing else is relaxed there",
  );

  const adapter = must(await selectorsFor(eslint, "src/adapters/http.ts"), "adapter selectors");
  assert.ok(
    !adapter.includes("ThrowStatement") && !adapter.some((s) => s.startsWith("CatchClause")),
  );
  assert.equal(await isOff(eslint, "src/adapters/http.ts", "no-restricted-imports"), true);

  const fake = must(await selectorsFor(eslint, "test/fakes/fetch.ts"), "fake selectors");
  assert.ok(!fake.includes("ThrowStatement"), "fakes may throw as foreign code does");
  assert.ok(
    fake.some((s) => s.includes("'json'")),
    "but still may not call .json()",
  );

  assert.equal(await selectorsFor(eslint, "tools/coercions.ts"), undefined);
  assert.equal(await isOff(eslint, "tools/coercions.ts", "no-console"), true);
});
