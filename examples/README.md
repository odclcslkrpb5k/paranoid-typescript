# Examples

Reference implementations of rules in the standard. The standard is the authority; each example
shows one way to meet a rule, and the rule links here. Everything in this directory is held to the
standard itself: every compiler setting of chapter 02, the lint of chapter 03, errors as values,
tests that cannot reach the network.

The only thing a workstation needs is Docker. The environment — Node 24 LTS, git, and every
package at an exact version — is defined in [`Dockerfile`](Dockerfile) and
[`compose.yaml`](compose.yaml), and CI runs the same service. TypeScript is 6.0 (typescript-eslint
does not yet support 7.0); tests use `node:test`, valibot and fast-check.

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
| [`Dockerfile`](Dockerfile), [`compose.yaml`](compose.yaml)                                       | the environment as files: runtime, git and packages pinned; the check with no network                                    | TC-9, TC-1, TS-1, TS-8     |
| [`../.github/workflows/examples.yml`](../.github/workflows/examples.yml)                         | CI running the same compose service                                                                                      | TC-5, TC-9                 |
| [`test/cli.test.ts`](test/cli.test.ts)                                                           | the git-driven tools run end to end in throwaway repositories                                                            | BD-2, CD-7                 |

`tools/` and `lint/` keep every type and lint rule but are exempt from the architecture rules of
chapter 04: they are small programs whose whole job is to drive git, `tsc` and ESLint, so each is
its own adapter.

## Running it

    docker compose run --build --rm check

builds the image (installing from the lockfile and verifying registry signatures, which needs the
network) and then runs every check with no network at all: formatting, the type check, the
compiler-option fixtures, lint, the tests, and a scan of the whole repository for hidden
characters. `--build` makes the run check the tree as it is now, never an older image (TS-8).

    HOST_UID=$(id -u) HOST_GID=$(id -g) docker compose run --build --rm fix

formats and lint-fixes the files in place, as the workstation's user. Anything else runs the same
way, for example `docker compose run --build --rm check npm run coercions`.

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
- `tsc-baseline`'s command line is not tested end to end; its decisions are tested as pure
  functions.
