# 09 Adoption

A new project starts at the full level on its first commit, which costs nearly nothing. An existing
codebase gets there by a path whose order matters, behind a ratchet that only lets the number of
violations go down.

### AD-1 (MUST) A new project starts at the full level.
Every setting in chapters 02 and 03 on, and chapter 04's structure in place, before the first
feature.

**Why:** measured across seven services, the compiler settings cost between none and six errors
each when adopted early; on a codebase that grew without them they cost thousands.

**Enforced by:** Engineer — the settings themselves.

### AD-2 (MUST) On an existing codebase, every flag and rule turns on behind a baseline that can only shrink.
- **Lint:** ESLint's bulk suppressions (`eslint --suppress-all`, recorded in
  `eslint-suppressions.json`) record today's violations per file and rule. A new violation fails;
  so does a suppression that is no longer needed, so the file only shrinks (prune with
  `--prune-suppressions`).
- **Compiler:** a small script runs `tsc --noEmit`, records error counts per file and error code in
  a committed baseline, and fails if any count goes up or a file with no entry has errors. The
  compiler needs no suppression comments that way.
- **The gate compares against the committed baseline at origin**, not the working tree's copy, so a
  change cannot raise the baseline and add the violation in one commit.
- **New files are clean from their first commit**: the baseline covers only files that existed when
  it was taken.
- **Key entries on rule, file and count, never on line positions**, which churn with every edit.
- **Regenerate the baseline after each step of the path (AD-4)**, refusing any count that rises. A
  step such as boundary parsing removes many entries at once (most `no-unsafe-*` findings are `any`
  flowing in from unparsed data), and the baseline should record that.

**Why:** turning everything on at once means thousands of errors; one change fixing them all would
be unreviewable, and an agent "fixing" them in bulk tends to add casts.

**Enforced by:** Engineer — both baselines in the gate. Known hole: within one file, a fixed
violation can be traded for a new one of the same rule, leaving the count unchanged. Review covers
that; no Engineer control for it is known.

**Prior art:** ESLint bulk suppressions (ESLint 9.24); betterer; the general "ratchet" technique.

### AD-3 (MUST) Compiler flags first; retake the lint baseline after every compiler change.
Typed lint rules read the compiler's types, so a compiler flag changes what they report. Lint the
whole project with and without each flag before turning it on.

**Why:** on one codebase, turning on `strictNullChecks` added 362 `restrict-template-expressions`
errors across 181 files, plus a few `no-unsafe-*`.

**Enforced by:** Administer — the order of the path (AD-4).

### AD-4 (SHOULD) Follow the path in order, each step its own change, shipped and observed.
0. **Runtime and tooling as they are.** If the codebase is changing runtime or toolchain, do that
   first at today's strictness, so the port changes one thing at a time.
1. **Compiler settings** (CP-1), except `noPropertyAccessFromIndexSignature`, behind the compiler
   baseline.
2. **Type-aware lint** (chapter 03) behind the lint baseline, taken after step 1. New code is held
   to it at once.
3. **Parse at the boundary** (chapter 05). This removes most index-signature reads and most casts
   in one move, so it comes before burning anything down by hand; turn on
   `noPropertyAccessFromIndexSignature` at its end.
4. **Errors as values** (chapter 04): adapters first, then the whole codebase (ER-1).
5. **Branded identifiers** (BD-5). It touches everything that handles an id, so it follows the
   parse functions of step 3, which mint them.
6. **Burn the baselines down to zero, tests included.** Remove `!` by machine: the linter's JSON
   output gives each assertion's span; replace `x!` with `must(x)` innermost first, re-lint, and
   repeat (fifty-six sites took three rounds). Done means both baseline files are empty and
   deleted.

Steps 3 to 5, done well, replace each `!` with a real check and build test fixtures through typed
helpers, so step 6 shrinks to a check rather than work. Each step is a unit of work with a count
that can be checked: the baseline entries it removes.

**Why:** each step depends on the one before. The order was found by running it on production
services.

**Enforced by:** Administer — this rule.

### AD-5 (MUST) Every step of the path is reviewed, mutation-tested, and read against production before and after.
Review each step with several briefs (SH-4); mutation-test every new test (TS-5); and take a
baseline of production behaviour before the step, then read again after a full cycle of the
service. A shadow deployment (SV-6) is ideal; without one, replay recorded production answers
through the new build. A restart that resets a report before it prints means nothing was compared:
say so rather than claim "no change".

**Why:** every step changes behaviour somewhere, even when it looks type-level: an abort that used
to end a run now carries on, a timeout reads as a different error, a refused value ends an item
differently. One service's "no change in shadow" turned out never to have been measured.

**Enforced by:** Administer — the ship cycle.

### AD-6 (SHOULD) Measure before planning.
Before starting, count: type assertions (excluding `as const`), `as unknown as`, `!`, `any` in a
type position, `@ts-` comments and lint suppressions, `throw` statements and `catch` blocks,
`JSON.parse` / `Number(` / `String(` calls, files importing an external module directly; and the
compile errors each stricter flag produces, split into source, tests and scripts. Each step then
has a number to move.

**Why:** on one agent-written codebase of 59,000 lines the count was about 667 type assertions and
280 non-null assertions, and the three main flags produced 2,349 errors, 1,746 of them in tests.
Most source errors came from database rows typed as index signatures, which step 3 removes. Without
the count, nobody would have guessed the tests were three quarters of the work.

**Enforced by:** Administer.
