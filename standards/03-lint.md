# 03 Lint

The compiler checks that types fit. Type-aware lint checks what the types are used for: whether a
promise is awaited, whether a union is handled in full, whether a value of type `any` escaped into
code that trusts it. A linter without type information cannot see any of those, which is the main
reason this standard's reference toolchain is typescript-eslint.

### LN-1 (MUST) Lint with typescript-eslint's `strictTypeChecked` configuration, with type information, over every file the compiler checks.
Every rule is an error. There are no warnings.

**Why:** a warning is an Administer control in disguise: it asks someone to notice, and in an
agent's output nobody does.

**Enforced by:** Engineer — the lint step of the check command (TC-5), with `--max-warnings 0` as a
backstop.

**Prior art:** typescript-eslint's `strict-type-checked` shared config.

### LN-2 (MUST) No escape hatches.
- `no-explicit-any`, and the whole `no-unsafe-*` family (`assignment`, `call`, `member-access`,
  `return`, `argument`). `JSON.parse` and similar calls return an implicit `any` that
  `no-explicit-any` never sees; the `no-unsafe-*` rules catch where it flows.
- `consistent-type-assertions` with `assertionStyle: "never"`: no `as`. `as const` stays legal. The
  one place a cast is allowed is a brand's constructor (BD-5), exempted by file in the lint config.
- `no-non-null-assertion`.
- `ban-ts-comment` with no allowances: no `@ts-ignore`, `@ts-expect-error` or `@ts-nocheck`.

**Why:** each is a place where someone overruled the type system, and the override outlives its
reason. Together they turn the coercion review (BD-2) into a build error for everything but the
coercions lint cannot judge.

**Enforced by:** Engineer.

### LN-3 (MUST) Every switch over a union is exhaustive, and a `default` does not count.
`switch-exhaustiveness-check` with `considerDefaultExhaustiveForUnions: false`, and the `default`
branch of a switch over a union calls `unreachable(x)` (ER-2), whose parameter is `never`.

**Why:** adding a variant to a union becomes a compile-time list of every place that must handle
it. This is the property Rust's `match` is usually the argument for.

**Enforced by:** Engineer.

### LN-4 (MUST) Every promise is awaited, returned, or handed to something that handles it.
`no-floating-promises`, `no-misused-promises`, `return-await` (`in-try-catch` or `always`),
`require-await`, `promise-function-async`.

**Why:** an unawaited promise is a failure nobody sees, and the commonest way to turn a failure
into success (ER-6).

**Enforced by:** Engineer.

### LN-5 (MUST) A condition is a boolean.
`strict-boolean-expressions`: `if (count)` on a number is refused; the code says `count !== 0`.

**Why:** `0`, `""` and `NaN` are falsy, and a truthiness test on them is a bug waiting for the
value that is legitimately zero or empty.

**Enforced by:** Engineer.

### LN-6 (MUST) Results are used. (PROPOSED)
A call that returns a `Result` (ER-1), or a promise of one, is not discarded: it is assigned,
returned, or branched on.

**Why:** a discarded `Result<void, E>` is exactly the shape of a write whose failure nobody
handled. A linter without type information cannot see it, and projects without type-aware lint
found they had to cover it with tests and mutation testing, which is weaker.

**Enforced by:** Engineer, once built. typescript-eslint has no such rule. neverthrow ships one for
its own type (`eslint-plugin-neverthrow`, `must-use-result`); a project with its own `Result` type
writes a small typed rule, tested and mutation-tested (LN-9). Until then, Administer.

**Prior art:** Rust's `#[must_use]`.

### LN-7 (SHOULD) The rest of the strict set, and a few more.
`restrict-template-expressions`, `no-unnecessary-condition`, `prefer-readonly`,
`explicit-module-boundary-types`, `consistent-type-imports`, `only-throw-error`, `no-deprecated`,
`use-unknown-in-catch-callback-variable`, `prefer-nullish-coalescing`. Core ESLint `eqeqeq` as
`["error", "always", { "null": "ignore" }]`, which keeps `x == null` — the idiom that matches both
`null` and `undefined`.

**Enforced by:** Engineer.

### LN-8 (MUST) No suppression comments.
`eslint-disable` comments are refused (`@eslint-community/eslint-comments/no-use`), and
`linterOptions.reportUnusedDisableDirectives` is `"error"`. Where a rule must not apply — a brand
constructor's cast, an adapter's `throw` — the exception is written in the lint configuration,
scoped to the files, where a reviewer sees it once rather than scattered through the code. Legacy
violations go in the baseline (AD-2), never in comments.

**Why:** a suppression comment is a local override nobody re-reads. In config it is a decision.

**Enforced by:** Engineer.

### LN-9 (SHOULD) Restricted-syntax rules encode the architecture, and custom rules are tested.
`no-restricted-syntax`, `no-restricted-imports`, `no-restricted-globals` and
`no-restricted-properties` carry the error-handling rules of chapter 04: where `throw` and `catch`
may appear, which files may import a driver, which built-ins must go through a wrapper. A custom
lint rule is code, held to the same tests as any other, and each of its refusals is mutation-tested
(TS-5): a rule that never fires looks exactly like a codebase that never breaks it.

**Enforced by:** Engineer.

## What lint cannot see

A call that throws with no `throw` in sight (`new URL("bad")`, a brand's constructor), a combinator
that settles rejections (`Promise.allSettled`), and anything about what data means. Those stay with
chapter 04's adapter rules, tests and review.
