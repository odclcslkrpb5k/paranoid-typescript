// The lint layer of the standard (chapter 03), and the error-handling architecture of chapter 04
// written as restricted-syntax rules. Each exemption is scoped to files here, never granted by a
// comment in the code (LN-8).
import comments from "@eslint-community/eslint-plugin-eslint-comments";
import tseslint from "typescript-eslint";
import { plugin as paranoid } from "./lint/must-use-result.ts";

const throwing = {
  throw: { selector: "ThrowStatement", message: "Only panic() throws (ER-2); return a Result." },
  // Every spelling: `Promise.reject`, `Promise["reject"]`, `Promise[`reject`]`, `Promise?.reject`.
  reject: {
    selector:
      "CallExpression[callee.object.name='Promise']:matches([callee.property.name='reject'], [callee.property.value='reject'], [callee.property.quasis.0.value.cooked='reject'])",
    message: "Promise.reject is a throw (ER-2); return a Result.",
  },
  // A promise built with a `reject` parameter is a throw by another name.
  executor: {
    selector: "NewExpression[callee.name='Promise'] > :function[params.length>=2]",
    message: "A Promise executor's reject is a throw (ER-2); wrap callback APIs in an adapter.",
  },
};

// `catch` belongs in adapters, and in an entry point's counted catch-all, named with a `Net`
// suffix so this selector can find it (ER-5).
const NET =
  ":matches(FunctionDeclaration[id.name=/Net$/], VariableDeclarator[id.name=/Net$/] > :function, MethodDefinition[key.name=/Net$/] > FunctionExpression)";
const catching = {
  clause: {
    selector: `CatchClause:not(${NET} CatchClause)`,
    message: "catch only in an adapter or a *Net catch-all (ER-3, ER-5).",
  },
  method: {
    selector: `CallExpression:matches([callee.property.name='catch'], [callee.property.value='catch'], [callee.property.name='then'][arguments.length=2], [callee.property.value='then'][arguments.length=2]):not(${NET} CallExpression)`,
    message: "Handling a rejection belongs in an adapter or a *Net catch-all (ER-3, ER-5).",
  },
};

const builtins = {
  url: {
    selector: "NewExpression[callee.name='URL']",
    message: "new URL throws; use parseUrl from src/adapters/builtins.ts (ER-4).",
  },
  json: {
    selector: "CallExpression[callee.property.name='json'][arguments.length=0]",
    message: "Response.json() throws and returns any; read text and use parseJson (ER-4, BD-1).",
  },
};

const restrictedGlobals = [
  "BigInt",
  "atob",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "structuredClone",
].map((name) => ({
  name,
  message: `${name} can throw; call it through a wrapper in src/adapters/ (ER-4).`,
}));

/** Imports allowed outside adapters: relative modules, and libraries that never throw on their
 * documented path (ER-3). */
const domainImports = {
  patterns: [
    {
      regex: "^(?!\\.{1,2}/|valibot$)",
      message: "Foreign code is met only in src/adapters/ (ER-3).",
    },
  ],
};

/**
 * Tests may also reach what they test through: a loopback server (TS-9), a child process to run a
 * fixture under its own runner (TS-5), the files they read, and the linter whose configuration
 * they check (LN-9).
 */
const testImports = {
  patterns: [
    {
      regex:
        "^(?!\\.{1,2}/|valibot$|fast-check$|@typescript-eslint/rule-tester$|eslint$|node:(?:test|assert/strict|http|timers/promises|child_process|fs|os|path)$)",
      message: "Tests import the test runner, assertions, fakes and the code under test.",
    },
  ],
};

export default tseslint.config(
  // Fixtures that exist to fail a check are left out; the ones that should be clean are linted.
  {
    ignores: [
      "node_modules/",
      "test/fixtures/lint/",
      "test/fixtures/rejected/",
      "test/fixtures/types/",
      "eslint.config.js",
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    plugins: { "@eslint-community/eslint-comments": comments, paranoid },
    rules: {
      // LN-2: no escape hatches. The preset allows @ts-expect-error with a description; this does not.
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true, "ts-check": false },
      ],
      // LN-3
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true },
      ],
      // LN-4. node:test's `test` returns a promise the runner itself awaits; naming it here is the
      // rule's documented way to say so, rather than a `void` before every test.
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: ["test", "it", "describe", "suite"] },
          ],
        },
      ],
      "@typescript-eslint/return-await": ["error", "always"],
      "@typescript-eslint/promise-function-async": "error",
      // LN-5: the defaults allow numbers and strings in conditions, which is the bug.
      "@typescript-eslint/strict-boolean-expressions": [
        "error",
        { allowNumber: false, allowString: false, allowNullableObject: false },
      ],
      // LN-6
      "paranoid/must-use-result": "error",
      // Matches the compiler's own convention for unused parameters (CP-1).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // LN-7
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      // LN-8
      "@eslint-community/eslint-comments/no-use": "error",
      // Chapter 04.
      "no-restricted-syntax": [
        "error",
        throwing.throw,
        throwing.reject,
        throwing.executor,
        catching.clause,
        catching.method,
        builtins.url,
        builtins.json,
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "JSON",
          property: "parse",
          message: "Use parseJson, which takes a schema (ER-4, BD-1).",
        },
        {
          object: "JSON",
          property: "stringify",
          message: "JSON.stringify throws on a bigint or a cycle; serialize in an adapter (ER-4).",
        },
      ],
      "no-restricted-globals": ["error", ...restrictedGlobals],
      "no-restricted-imports": ["error", domainImports],
      // SV-25: code logs only through the one logger, which these examples do not have.
      "no-console": "error",
    },
  },
  {
    files: ["src/result.ts"],
    rules: { "no-restricted-syntax": ["error", ...without(throwing.throw)] },
  },
  {
    // Adapters meet foreign code: they may import it, catch what it throws, and call the throwing
    // built-ins, which is the whole point of having them (ER-3, ER-4).
    files: ["src/adapters/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", throwing.reject],
      "no-restricted-properties": "off",
      "no-restricted-globals": "off",
      "no-restricted-imports": "off",
    },
  },
  {
    // Tests stringify their own values into failure messages, where a throw just fails the test.
    files: ["test/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", testImports],
      "no-restricted-properties": [
        "error",
        { object: "JSON", property: "parse", message: "Use parseJson (ER-4, BD-1)." },
      ],
    },
  },
  {
    // Fakes stand for foreign code, so they may throw and reject as it does (ER-3). They also
    // return promises already settled, where `promise-function-async` and `require-await` cannot
    // both be met; the first matters more, since it stops a synchronous throw (LN-4).
    files: ["test/fakes/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        catching.clause,
        catching.method,
        builtins.url,
        builtins.json,
      ],
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // Tools and lint rules are the edge of their own small programs: they drive git, tsc and ESLint,
    // and report to a terminal. They keep every type rule; only the architecture rules are relaxed.
    files: ["tools/**/*.ts", "lint/**/*.ts"],
    rules: {
      "no-restricted-syntax": "off",
      "no-restricted-properties": "off",
      "no-restricted-globals": "off",
      "no-restricted-imports": "off",
      "no-console": "off",
    },
  },
);

/** The restricted-syntax entries other than `exempt`, for a file allowed that one construct. */
function without(exempt) {
  return Object.values({ ...throwing, ...catching, ...builtins }).filter(
    (entry) => entry !== exempt,
  );
}
