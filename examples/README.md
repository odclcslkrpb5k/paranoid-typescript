# Examples

Reference implementations of rules in the standard. The standard is the authority; each example
shows one way to meet a rule, and the rule links here. Everything in this directory is held to the
standard itself: every compiler setting of chapter 02, the lint of chapter 03, errors as values,
tests that cannot reach the network.

Node 24 LTS, TypeScript 6.0 (typescript-eslint does not yet support 7.0), `node:test`, valibot,
fast-check.

## What is here

| File                                                                                             | Shows                                                                                                                    | Rules                      |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| [`tsconfig.json`](tsconfig.json)                                                                 | every compiler setting, for running `.ts` directly on Node                                                               | CP-1, CP-2, CP-4, TC-2     |
| [`eslint.config.js`](eslint.config.js)                                                           | `strictTypeChecked` plus the additions; the error architecture as restricted-syntax rules, each exemption scoped by file | LN-1 to LN-9, ER-2 to ER-5 |
| [`src/result.ts`](src/result.ts)                                                                 | `Result`, `ok`, `err`, `panic`, `unreachable`                                                                            | ER-1, ER-2                 |
| [`src/adapters/builtins.ts`](src/adapters/builtins.ts)                                           | `parseJson` with a schema, `parseUrl`, `parseBigInt`: throwing built-ins as `Result`s                                    | ER-4, BD-1                 |
| [`src/adapters/http.ts`](src/adapters/http.ts)                                                   | a `fetch` adapter: a deadline covering the body, failures classified by their marks, no URL or body in errors            | ER-3, SV-20, DP-3, DP-6    |
| [`src/ids.ts`](src/ids.ts)                                                                       | branded ids minted by a schema, with no cast                                                                             | BD-5, BD-4                 |
| [`src/problems.ts`](src/problems.ts)                                                             | schema issues reduced to member paths, never values                                                                      | DP-3                       |
| [`src/records.ts`](src/records.ts)                                                               | the one `isRecord`                                                                                                       | BD-7                       |
| [`lint/must-use-result.ts`](lint/must-use-result.ts)                                             | a typed lint rule refusing a discarded `Result`                                                                          | LN-6                       |
| [`test/support/assert.ts`](test/support/assert.ts)                                               | `must`, `succeeds`, `fails`                                                                                              | CP-2, TS-13                |
| [`test/support/leaks.ts`](test/support/leaks.ts)                                                 | a test that leaves a timer or socket open fails                                                                          | TS-3                       |
| [`test/http.test.ts`](test/http.test.ts)                                                         | an HTTP client tested against a loopback server, and a body that breaks halfway                                          | TS-9, SV-20                |
| [`test/*.test.ts`](test/)                                                                        | property-based tests of every parser, with a recorded seed                                                               | TS-16                      |
| [`test/meta.test.ts`](test/meta.test.ts), [`test/lint-config.test.ts`](test/lint-config.test.ts) | the checks themselves can fail                                                                                           | TS-5, TS-6, LN-9           |
| [`tools/check-fixtures.ts`](tools/check-fixtures.ts)                                             | each compiler option proven by a fixture; type-level tests                                                               | CP-3, BD-5                 |
| [`tools/tsc-baseline.ts`](tools/tsc-baseline.ts)                                                 | a ratchet for compiler errors, read from the base branch                                                                 | AD-2                       |
| [`tools/coercions.ts`](tools/coercions.ts)                                                       | every coercion on the lines a change adds, for review                                                                    | BD-2                       |
| [`tools/hidden-chars.ts`](tools/hidden-chars.ts)                                                 | literal hidden characters found and escaped                                                                              | CD-7                       |
| [`../.github/workflows/examples.yml`](../.github/workflows/examples.yml)                         | CI in the pinned image, with the network off for the check                                                               | TC-1, TC-5, TS-1           |

`tools/` and `lint/` keep every type and lint rule but are exempt from the architecture rules of
chapter 04: they are small programs whose whole job is to drive git, `tsc` and ESLint, so each is
its own adapter.

## Running it

In the pinned image, as CI does; installing needs the network, checking does not:

    IMAGE=node:24.22.0-slim
    docker run --rm -u "$(id -u):$(id -g)" -e npm_config_cache=/tmp/.npm \
      -v "$PWD:/w" -w /w "$IMAGE" npm ci
    docker run --rm --network none -u "$(id -u):$(id -g)" -v "$PWD:/w" -w /w "$IMAGE" npm run check

`npm run check` runs, in order: formatting, the type check, the compiler-option fixtures, lint and
the tests. `npm run coercions [<base>]`, `npm run baseline` and `npm run hidden-chars` need git.

## Known limits

- The leak check cannot see a timer or socket that has been `unref()`'d, since Node does not report
  one; misses a handle that appears more than a few milliseconds after its test ends; and counts by
  kind, so a resource closing and a new one of the same kind leaking in one test cancel out.
- Restricted-syntax rules match names, not types. The rule that refuses `response.json()` would
  also refuse any other method called `json` with no arguments; a typed rule checking the receiver
  is the missing control.
- `must-use-result` sees a `Result` discarded as a statement or returned into a `void` callback; it
  does not follow one stored in a variable that is then never read.
- The HTTP adapter reads a response body whole, without a size cap.
- `coercions` matches a line at a time: it skips comments and imports, and still flags `as` in
  prose inside a string. It is a list for a reviewer, not a verdict.
- The command-line halves of the git-driven tools are not tested in the suite, which runs in an
  image without git; their logic is tested as pure functions.
