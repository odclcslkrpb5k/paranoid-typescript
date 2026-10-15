/**
 * The must-use-result rule (LN-6), run against code with real type information. Each snippet
 * declares its own `Result`, which also proves the rule recognises one by shape rather than name.
 */
import path from "node:path";
import { after, describe, it } from "node:test";
import { RuleTester } from "@typescript-eslint/rule-tester";
import { mustUseResult } from "../lint/must-use-result.ts";
import "./support/leaks.ts";

// RuleTester calls these hooks as plain functions; node:test's return promises its runner awaits.
RuleTester.afterAll = (callback) => {
  after(callback);
};
RuleTester.describe = (text, callback) => {
  describe(text, callback);
};
RuleTester.it = (text, callback) => {
  it(text, callback);
};
RuleTester.itOnly = (text, callback) => {
  it(text, { only: true }, callback);
};

const tester = new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: path.join(import.meta.dirname, "fixtures/rule"),
    },
  },
});

const RESULT = `
type Outcome<T, E> = { ok: true; value: T } | { ok: false; error: E };
declare function save(): Outcome<void, "conflict">;
declare function saveLater(): Promise<Outcome<void, "conflict">>;
declare function notAResult(): { ok: boolean };
declare function log(): void;
declare const repo: { save(): Outcome<void, "conflict"> } | undefined;
type Maybe = { ok?: true; value: number } | { ok: false; error: string };
declare function maybe(): Maybe;
type AlwaysOk = { ok: true; a: number } | { ok: true; b: number };
declare function alwaysOk(): AlwaysOk;
`;

tester.run("must-use-result", mustUseResult, {
  valid: [
    { code: `${RESULT} const r = save();`, name: "assigned" },
    { code: `${RESULT} function f() { return save(); }`, name: "returned" },
    { code: `${RESULT} if (save().ok) log();`, name: "branched on" },
    {
      code: `${RESULT} async function f() { const r = await saveLater(); return r; }`,
      name: "awaited and returned",
    },
    { code: `${RESULT} let r; r = save();`, name: "assigned later" },
    { code: `${RESULT} notAResult(); log();`, name: "an ok-bearing object that is not a union" },
    { code: `${RESULT} alwaysOk();`, name: "a union whose every member has ok: true" },
    {
      code: `${RESULT} const rs = [1].map(() => save());`,
      name: "a callback whose return is used",
    },
    { code: `${RESULT} [1].forEach(() => log());`, name: "a void callback returning nothing" },
  ],
  invalid: [
    { name: "a bare call", code: `${RESULT} save();`, errors: [{ messageId: "discarded" }] },
    {
      name: "discarded with void",
      code: `${RESULT} void save();`,
      errors: [{ messageId: "discarded" }],
    },
    {
      name: "an awaited promise of a Result",
      code: `${RESULT} async function f() { await saveLater(); }`,
      errors: [{ messageId: "discarded" }],
    },
    {
      name: "an unawaited promise of a Result",
      code: `${RESULT} async function f() { saveLater(); }`,
      errors: [{ messageId: "discarded" }],
    },
    {
      name: "part of a comma expression",
      code: `${RESULT} save(), log();`,
      errors: [{ messageId: "discarded" }],
    },
    {
      name: "an optional call",
      code: `${RESULT} repo?.save();`,
      errors: [{ messageId: "discarded" }],
    },
    { name: "an optional ok", code: `${RESULT} maybe();`, errors: [{ messageId: "discarded" }] },
    {
      name: "returned into a void callback",
      code: `${RESULT} [1].forEach(() => save());`,
      errors: [{ messageId: "discarded" }],
    },
  ],
});
