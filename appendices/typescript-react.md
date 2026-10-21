# Appendix: Paranoid TypeScript (React)

How the core standard carries into a browser application built on React. The language is the core's
own, so this appendix is short: it covers only where a UI framework changes how a core rule is met,
or forces a deviation. Like every appendix it defines no rules of its own; each item names the core
rule it serves. A core rule not mentioned here applies as written, wherever it applies.

Two things shape everything below. The framework is the runtime: the program is written in React's
components and hooks, and in the libraries around them, not merely calling them. And React acts on
throws: an error boundary, Suspense and most routers and stores respond to an exception and to
nothing else, so errors as values (chapter 04) stop at the framework's edge, as they do at
Django's.

**Status.** Drawn from the measurements and incidents of one Django and React application, whose
frontend is about 380,000 lines of TypeScript, almost all of it agent-written, taking the
strictness path (AD-4) from plain `strict`. It has not yet adopted this appendix: read every item
as (PROPOSED). Each named setting was checked on 2026-10-21 against TypeScript 6.0.3, ESLint
10.13.0, typescript-eslint 8.72.0, eslint-plugin-react-hooks 7.1.1, React 19.3.1, jsdom 30.1.3 and
`@graphql-codegen/typescript` 6.1.2. Tool options change between versions; check each against the
version you install.

## Compiler (chapter 02)

- **`exactOptionalPropertyTypes` and props (CP-1).** In the application above, 1,155 of the flag's
  1,275 errors (91%) were in `.tsx` files, nearly all one idiom: `<Comp prop={maybeUndefined} />`
  into a props type whose member is `prop?: T`. Declare a component's own optional props
  `prop?: T | undefined` wherever callers pass a value that may be `undefined`, which in React is
  nearly always. A library's props that refuse an explicit `undefined` get a small wrapper
  component that omits the prop, never a cast (LN-2) and never a `?? undefined` at each call site.
- **Styles keep their literal keys (CP-1).** A styles object whose keys become class names
  (tss-react, JSS, MUI's `makeStyles`) is checked with `satisfies Record<string, CSSObject>`, never
  annotated `: Record<string, CSSObject>`. The annotation turns the `classes` map into an index
  signature, and every `classes.root` becomes an error under `noPropertyAccessFromIndexSignature`:
  about 85% of that flag's 5,966 errors in the application above. Missing Engineer control: a
  `no-restricted-syntax` selector refusing an index-signature annotation on a styles object.
- **Generated code (CP-2).** GraphQL and OpenAPI codegen output is excluded by path only under
  CP-2's three conditions. For GraphQL codegen, `strictScalars` with a `scalars` map (without it, a
  custom scalar is `unknown`) and `avoidOptionals` (a nullable field is present as `Maybe<T>`, not
  optional).

## Lint (chapter 03)

- **The Rules of React are errors (LN-1).** eslint-plugin-react-hooks 7.1 ships its flat
  configuration as `configs.flat["recommended-latest"]`: seventeen rules, including the React
  Compiler's (`refs`, `purity`, `immutability`, `set-state-in-effect`, `static-components` and the
  rest). Three of them are warnings by default (`exhaustive-deps`, `incompatible-library`,
  `unsupported-syntax`); set them to `"error"`. The plain `configs["recommended-latest"]` is the
  legacy configuration, which ESLint 10 refuses to load.
- **A suppression changes what runs (LN-8).** The React Compiler skips any component or hook that
  carries a suppression of a `react-hooks` rule, so the comment silently removes its memoization as
  well as the finding. The application above cleared 32 `exhaustive-deps` suppressions and one
  `rules-of-hooks` suppression before turning the compiler on.
- **The opt-out is a coercion (BD-2).** Where the compiler is used, a component's `"use no memo"`
  directive carries a reason, and a check lists every one, as it lists coercions.
- **Conditions in JSX (LN-5).** `{count && <Badge />}` renders the text `0` when `count` is zero.
  LN-5's `allowNumber: false` refuses it; the code says `{count > 0 && <Badge />}`. The rule checks
  the operands of `&&` in JSX like any other: it refused both a number and a string operand.
- **Autofix (LN-10)** reaches React code too: a fixer that deleted an assertion generic JSX needed
  left a component whose props no longer resolved.

## Errors (chapter 04)

- **The framework is the runtime (ER-3).** React, react-dom, the component and styling libraries,
  the router and the store are named exceptions in `no-restricted-imports`: every component imports
  them, and an adapter around `useState` is not an adapter. In the application above, 3,564 of
  5,632 files imported a package directly, most of them these. What ER-3 still confines to adapters
  is I/O: HTTP, the GraphQL client's network calls, storage (`localStorage` throws when full or
  blocked), the clipboard and other browser APIs that throw.
- **The seams where a `Result` becomes a throw (ER-3)** are listed with their reasons in the
  project's agent instructions (RP-6): an error boundary, Suspense, a router's loader or action, a
  thunk the store records as rejected, and the GraphQL client's error path. What crosses is an
  `Error` subclass carrying the typed failure, never the failure itself: 279 throws of a plain
  object reached the console as the bare word `Object`. typescript-eslint's `only-throw-error` (in
  LN-1's preset) refuses those.
- **Catch-alls (ER-5, ER-9).** A root error boundary that records the failure, and `window`
  handlers for `error` and `unhandledrejection`, each counted and recording the class, never the
  message (DP-3).

## Boundaries (chapter 05)

- **The browser is a client that outlives its server's deploy (BD-1).** A tab stays open across
  deploys, so its parsers read an unknown enumeration value as the explicit unknown variant, and
  the UI shows a neutral state for it.
- **Generated types are claims (CP-2, BD-8).** Types from codegen describe what the owner says it
  sends. Data typed by them is still parsed at the boundary, and where they are wrong (a column
  declared nullable that never is, a response schema whose required members were copied from the
  request's) the fix is at the owner.
- **One key, two wire forms (BD-5).** A GraphQL `ID` string and a REST number for the same key are
  one brand with two parse functions.

## Testing (chapter 07)

- **Framework warnings fail tests (TS-18).** React's development build warns about a list without
  keys, a state update outside `act`, and an input switching between uncontrolled and controlled;
  react-redux 9 warns when a selector returns a new object for the same input. Record them and fail
  in `afterEach`: a throw from inside `console.warn` during a render is caught by the nearest error
  boundary, which renders its fallback, and the test passes. React passes a format string as the
  first argument, so the recorded text is stable enough to allow by exact match:

        const recorded: string[] = [];
        const allowed: ReadonlySet<string> = new Set<string>([]);
        for (const level of ["warn", "error"] as const) {
          console[level] = (...args: unknown[]) => {
            recorded.push(String(args[0]));
          };
        }
        afterEach(() => {
          const unexpected = recorded.filter((text) => !allowed.has(text));
          recorded.length = 0;
          assert.deepEqual(unexpected, []);
        });

  Under `node:test` with jsdom, this failed a render of a list without keys and passed the same
  list with keys.
- **The compiler changes runtime behaviour, so test with it on (TS-4).** The React Compiler
  evaluates a closure's dependencies during render, so `onClick={() => use(a.b.c)}` reads `a.b.c`
  on every render: two test stores that omitted part of a reducer's state began to crash only once
  the compiler was on. It also caches what it believes is pure, so a render-time read of mutable
  state React cannot see (a grid library's column API) was cached on the object's identity and went
  stale. An end-to-end run with the compiler on and off, on the same seed, caught it.
- **Caches and path filters (TS-8).** The transformer's configuration file (`.swcrc`,
  `babel.config.js`) and its version are in the test runner's transform cache key, the bundler's
  persistent cache version (`cache.version` in webpack) and every CI path filter.
- **End-to-end tests read the server too (TS-17).** An assertion on a count, a status or a role
  shown on screen is paired with an API read of the same value.

## What it does not replace

Lint and the compiler cannot see whether a component re-renders too often, whether an effect runs
at the right time, or whether the page is usable. Those stay with the framework's own warnings
(TS-18), end-to-end tests, and review.
