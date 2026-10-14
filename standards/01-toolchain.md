# 01 Toolchain

The reference toolchain is Node.js running TypeScript by type stripping, `tsc` as the checker and
typescript-eslint as the linter. The rules are written so that most carry over to Deno or Bun; the
ones that do not say so.

### TC-1 (MUST) Pin one runtime version per project, the same in development, CI and the image.
A version bump is one change across every place the runtime is named (`.node-version` or `.nvmrc`,
`engines`, the image's `FROM`, CI), not drift.

**Why:** a runtime older than the project's TypeScript ignores, without a word, a compiler option
it does not know. A test image on an older runtime ignored `erasableSyntaxOnly` and passed code the
production runtime refused.

**Enforced by:** Engineer, partly: `engine-strict=true` in `.npmrc` makes an install on the wrong
Node fail. Missing Engineer control: a test that reads every place the version is named and fails
when they differ. See also CP-3.

### TC-2 (MUST) Write only TypeScript that a type-stripper can run.
No enums, namespaces, constructor parameter properties (`constructor(readonly x: T)`) or other
syntax that needs compiling; type-only imports written `import type`. A parameter property becomes
a declared field assigned in the constructor. The compiler settings are in CP-1.

**Why:** Node runs `.ts` files by stripping their types and refuses anything that must be compiled.
Code that is already erasable runs on Node, Deno and Bun, and through `tsc`, unchanged, so the
choice of runtime stays open. Projects on one runtime had to plan a move when its end of
development was announced; the ones already erasable faced no rewrite. Measured across seven
services, the only cost was one mechanical rewrite per parameter property.

**Enforced by:** Engineer — `erasableSyntaxOnly` and `verbatimModuleSyntax` (CP-1).

### TC-3 (MUST) Pin every dependency to an exact version, commit the lockfile, and install frozen.
Exact versions in `package.json` (`save-exact=true` in `.npmrc`), no `^` or `~`. Every command that
resolves dependencies — CI, the image build, the test run — installs from the lockfile and fails
rather than updating it (`npm ci`, `pnpm install --frozen-lockfile`). Where the tool can freeze the
lockfile in project configuration rather than per command, do that.

**Why:** an image must be exactly the commit it is labelled with; an unpinned dependency makes two
builds of one commit differ. A frozen flag on one command alone leaves the others free to rewrite
the lockfile: a workstation runtime newer than the image's rewrote it mid-run, and the checks then
judged a tree that was no longer the one being shipped.

**Enforced by:** Engineer — the frozen install fails on drift.

### TC-4 (SHOULD) Do not run dependency install scripts, and do not install a version on the day it is published.
(PROPOSED) Disable lifecycle scripts by default and allow them per package where one is needed
(pnpm does this by default and lists exceptions in `onlyBuiltDependencies`; npm has
`ignore-scripts`). Where the package manager supports a minimum release age (pnpm's
`minimumReleaseAge`), set one of days, not hours.

**Why:** the npm compromises of September 2025 — maintainer accounts phished and popular packages
republished, and a self-replicating worm — spread through install scripts and through versions
installed within hours of publication, before anyone had noticed them.

**Enforced by:** Engineer — package manager configuration, committed.

### TC-5 (MUST) One command runs every check, and CI runs exactly that command.
Formatting check, lint, type check (`tsc --noEmit`) and tests, in one script (`npm run check`). A
check that runs only in an editor, only in an agent's skill or only on one machine is skipped
everywhere else. CI's required status is that command's exit status.

**Why:** a check is only a control where it cannot be skipped.

**Enforced by:** Engineer — a required CI status on the default branch.

### TC-6 (MUST) Format with a formatter, and fail the check on unformatted code.
Which formatter (Prettier, Biome, dprint) is the project's choice; arguing style is not. Line width
100 is a reasonable default.

**Why:** formatting is a diff that hides the real one. With a formatter in the check, no review
spends a word on it.

**Enforced by:** Engineer — the formatter's check mode in TC-5. AG-5 covers the formatter reflowing
files it should not touch.

## Open questions

- **Formatter:** Prettier or Biome. Either works, since lint is typescript-eslint regardless;
  Biome's own linter does not go as deep on type-aware rules, so it would format only.
- **Runtime-specific permission flags:** Node's permission model (`--permission`, `--allow-fs-read`
  and friends) is the counterpart of Deno's `--allow-*`; DE-10 asks for it, but no project under
  this standard has run Node's model in production yet.
