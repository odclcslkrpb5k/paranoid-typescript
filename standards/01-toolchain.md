# 01 Toolchain

The reference toolchain is Node.js running TypeScript by type stripping, `tsc` as the checker and
typescript-eslint as the linter. The rules are written so that most carry over to Deno or Bun; the
ones that do not say so.

### TC-1 (MUST) Pin one runtime version per project, the same in development, CI and the image.
A version bump is one change across every place the runtime is named (`.node-version` or `.nvmrc`,
`engines`, the image's `FROM`, CI), not drift.

**Why:** which syntax the runtime can strip, and how its built-in APIs behave, change between
versions; code that passes in CI on one version can fail in production on another. Where the
runtime has its own built-in type checker (Deno), it is worse: an older one ignores, without a
word, a compiler option newer than its TypeScript. A test image on an older Deno ignored
`erasableSyntaxOnly` and passed code the production version refused. On Node, `tsc` is a pinned
dependency (TC-3) and refuses an option it does not know, so that half does not apply.

**Enforced by:** Engineer, partly: `engine-strict=true` in `.npmrc` makes an install on the wrong
Node fail. Missing Engineer control: a test that reads every place the version is named and fails
when they differ. See also CP-3.

### TC-2 (MUST) Write only TypeScript that a type-stripper can run.
No enums, namespaces, constructor parameter properties (`constructor(readonly x: T)`) or other
syntax that needs compiling; type-only imports written `import type`. A parameter property becomes
a declared field assigned in the constructor. The compiler settings are in CP-1.

**Why:** Node runs `.ts` files by stripping their types and refuses anything that must be compiled.
Code that is already erasable runs on Node, Deno and Bun, and through `tsc`, unchanged, so the
choice of runtime stays open. When Deno's end of development was announced in October 2026,
projects on it had to plan a move; the ones already erasable faced no rewrite. Measured across
seven services, the only cost was one mechanical rewrite per parameter property.

**Enforced by:** Engineer — `erasableSyntaxOnly` and `verbatimModuleSyntax` (CP-1).

**Prior art:** the TC39 Type Annotations proposal, which would make erasable type syntax part of
JavaScript itself.

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

### TC-4 (SHOULD) Do not run dependency install scripts, and do not install a version on the day it is published. (PROPOSED)
Disable dependency build and install scripts by default and allow them per package where one is
needed (recent pnpm does this by default with an explicit allow list; npm has `ignore-scripts`).
Set a minimum release age of days, not hours (npm's `min-release-age` and pnpm's
`minimumReleaseAge` both exist; check the unit each uses). Setting names change between package
manager versions: check the current documentation rather than copying from here.

**Why:** in the npm compromises of September 2025, popular packages were republished from phished
maintainer accounts with malicious code, and a self-replicating worm spread through `postinstall`
scripts. Both reached users through versions installed within hours of publication, before anyone
had noticed them.

**Enforced by:** Engineer — package manager configuration, committed.

### TC-5 (MUST) One command runs every check, and CI runs exactly that command.
Formatting check, lint, type check (`tsc --noEmit`) and tests, in one script (`npm run check`). A
check that runs only in an editor, only in an agent's skill or only on one machine is skipped
everywhere else. CI's required status is that command's exit status.

**Why:** a check is only a control where it cannot be skipped.

**Enforced by:** Engineer — a required CI status on the default branch.

**Example:** [`package.json`](../examples/package.json),
[`../.github/workflows/examples.yml`](../examples/../.github/workflows/examples.yml).

### TC-6 (MUST) Format with a formatter, and fail the check on unformatted code.
Which formatter (Prettier, Biome, dprint) is the project's choice; arguing style is not. Line width
100 is a reasonable default.

**Why:** formatting is a diff that hides the real one. With a formatter in the check, no review
spends a word on it.

**Enforced by:** Engineer — the formatter's check mode in TC-5. AG-5 covers the formatter reflowing
files it should not touch.

### TC-7 (SHOULD) A new dependency is a review finding until justified. (PROPOSED)
The gate lists every package a change adds to the lockfile, direct and transitive, with its
version; review justifies each one, and the default answer is not to add it. On first adoption,
review only what each change adds, not the whole existing tree, or the first review is unreadable
and gets rubber-stamped. The listing is only as good as the lockfile is frozen (TC-3). CI verifies
registry signatures and provenance where the registry offers them (`npm audit signatures`).

**Why:** every dependency is code that runs with all of the process's permissions. In Node they
cannot be confined per library: the permission model (DE-10) applies to the whole process, so the
only per-library control is not installing the library. A transitive addition is invisible in a
`package.json` diff and obvious in a lockfile listing.

**Enforced by:** Engineer for the listing and the signature check; Administer for the judgement.
Missing Engineer control: a gate that refuses a lockfile addition with no justification recorded
beside it (a short file of approved packages, read from the base as well as the tree, SH-10).

**Prior art:** dependency review in GitHub and similar platforms; npm provenance (Sigstore).

### TC-8 (MUST) Pin TypeScript to a version the type-aware linter supports.
Check the linter's peer dependency range before moving TypeScript. In October 2026
typescript-eslint supports TypeScript below 6.1, while npm's `latest` TypeScript is 7.0, the native
port, so a project on this standard pins 6.0.x until the linter catches up.

**Why:** type-aware lint (chapter 03) is half of this standard's machine checking. A TypeScript the
linter cannot load either fails the install or, with peer checks bypassed, runs lint on a compiler
it was not built for.

**Enforced by:** Engineer — npm refuses to install a peer dependency outside its range (`ERESOLVE`)
unless forced; never pass `--force` or `--legacy-peer-deps` to get past it.

## Open questions

- **Formatter:** Prettier or Biome. Either works, since lint is typescript-eslint regardless;
  Biome's own linter does not go as deep on type-aware rules, so it would format only.
- **Runtime-specific permission flags:** Node's permission model (`--permission`, `--allow-fs-read`
  and friends) is the nearest counterpart of Deno's `--allow-*`, but coarser: it governs the file
  system, child processes and workers, and network access only as all or nothing, with no per-host
  grants. DE-10 asks for it, but no project under this standard has run it in production yet.
