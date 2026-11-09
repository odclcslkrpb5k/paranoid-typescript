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

**Enforced by:** Engineer, where the environment is a file (TC-9): the image pins the runtime once,
and everything runs in it. `engine-strict=true` in `.npmrc` makes an install on the wrong Node
fail. Missing Engineer control: a test that reads every place the version is still named (the
image, `engines`, a version file) and fails when they differ. See also CP-3.

### TC-9 (MUST) The environment is defined in files, and a workstation needs only Docker.
A `Dockerfile` pins everything the project needs to build, check, test and run: the base image by
digest, the runtime, OS packages and tools (git, a database client) at exact versions, and the
dependencies from the frozen lockfile (TC-3). Where more than one container is involved — a
database for the tests (TS-2), a service and its fakes — a compose file names them. Every check and
test runs through these files, on a workstation and in CI alike, with the same command (TC-5); a
README's prerequisites are Docker and nothing else. Development and test images get names of their
own (DB-2), and a check rebuilds the image in the same command that runs it (TS-8).

**Why:** a project that leans on what the workstation happens to have runs differently on every
workstation, and differently again in CI. The machine that wrote this standard's examples had a
Node eight major versions behind the project; an agent's interactive shell ran a different `grep`
from the one its scripts ran (AG-6); and the examples' git-driven tools went untested for exactly
as long as git was not part of their environment. The environment as a file also gives the rules
that need one somewhere to live: the network cut off for tests (TS-1), the runtime pinned once
(TC-1).

**Enforced by:** Engineer — CI runs the compose service and nothing else, so a dependency the files
do not declare fails there. Missing Engineer control: a check that the README, the CI workflow and
the scripts invoke no tool on the host but `docker` and `git`.

**Prior art:** development containers (the Dev Container specification); hermetic builds (Bazel).

**Example:** [`Dockerfile`](../examples/Dockerfile), [`compose.yaml`](../examples/compose.yaml).

### TC-2 (MUST) Write only TypeScript that a type-stripper can run.
No enums, namespaces, constructor parameter properties (`constructor(readonly x: T)`) or other
syntax that needs compiling; type-only imports written `import type`. A parameter property becomes
a declared field assigned in the constructor. The compiler settings are in CP-1.

**Why:** Node runs `.ts` files by stripping their types and refuses anything that must be compiled.
Code that is already erasable runs on Node, Deno and Bun, and through `tsc`, unchanged, so the
choice of runtime stays open. When Deno's end of development was announced in October 2026,
projects on it had to plan a move; the ones already erasable faced no rewrite. Measured across
seven services, the only cost was one mechanical rewrite per parameter property. The rule holds
where nothing strips types too: a 380,000-line frontend whose bundler compiles every syntax ruled
the flag out for that reason, yet the flag would have cost it one error, and it keeps the code
portable.

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

On npm 11.20, a committed `.npmrc` can hold all of it: `ignore-scripts=true`, `min-release-age=7`
(in days), and `allow-git=none`, which refused a `github:` dependency with `EALLOWGIT`. A script a
package needs is run by name, as a reviewed line in the project's setup, and the line must say
`npm rebuild <package> --ignore-scripts=false`: under the committed `ignore-scripts=true`, plain
`npm rebuild <package>` exited 0 without running the package's install script. A release age
guards only versions newly resolved; it does nothing for what the lockfile already holds. So the
check also reads the registry's publish date of every version in the lockfile and fails on one
younger than the minimum, or one resolved from anywhere but the registry: the setting is the
policy, the dates are the evidence. In a public template, `aube audit --fix=update` locked a zod
release 26 days old under a 30-day minimum. On npm 11.19.1, `min-release-age=7` refused an exact
pin 4 days old (`notarget`) and resolved a range to the newest version at least 7 days old.

**Why:** in the npm compromises of September 2025, popular packages were republished from phished
maintainer accounts with malicious code, and a self-replicating worm spread through `postinstall`
scripts. Both reached users through versions installed within hours of publication, before anyone
had noticed them.

**Enforced by:** Engineer — package manager configuration, committed, and the lockfile's publish
dates checked against it.

**Example:** [`.npmrc`](../examples/.npmrc),
[`tools/release-age.ts`](../examples/tools/release-age.ts).

### TC-5 (MUST) One command runs every check, and CI runs exactly that command.
Formatting check, lint, type check (`tsc --noEmit`) and tests, in one script (`npm run check`), run
in the project's environment (TC-9): `docker compose run --build --rm check`. A check that runs
only in an editor, only in an agent's skill or only on one machine is skipped everywhere else. CI's
required status is that command's exit status.

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

### TC-10 (MUST) Every check fails on a known vulnerability or malicious package in the lockfile that no expiring waiver covers. (PROPOSED)
A scanner reads the lockfile, so it judges what will be installed, a malicious version the
registry has since removed included. Any finding fails, whatever its severity: a severity
threshold silences every later finding at that level, not the one that was reviewed. It runs
wherever the check runs (TC-5), on every ship and every CI run, and on a daily schedule as well,
since an advisory is published without any change to the repository. A finding then stops
unrelated work until it is fixed or waived; that is the price of never missing one.
- **Waivers are one committed file, judged by the project, not by the scanner.** Each names one
  advisory and one package, says why, and expires no more than 90 days out; on that day the check
  fails again. The check refuses a waiver with no date, one that matches no finding, and any
  waiver of a malicious package (`MAL-*`, under any of its aliases): that package is removed, never
  waived. The scanner runs with no ignore list of its own, because scanners differ in how they
  honour one (below).
- **The scanner's exit status and its report are judged together.** One that cannot reach its
  advisory database has not checked anything, whatever its summary says.
- **The scanner is pinned by digest** and runs in the project's environment (TC-9): it is code
  run with the network and the source tree.
- **It is the one check with a network**, so it runs as a command of its own beside TC-5's,
  which keeps none (TS-1); every place that runs the check, CI among them, runs both.

Choosing one, measured in November 2026 against a lockfile holding a vulnerable `minimist@1.2.5`
and the malicious `debug@4.4.2`:
- osv-scanner 2.7.0 found both, named the malware by its `MAL-` id, honoured `ignoreUntil`, and
  refused a misspelled configuration key. It also accepted a waiver of the `MAL-` advisory, only
  warned about a waiver that matched nothing, and without a network exited 127 while printing
  "0 vulnerabilities".
- Grype 0.121.0 found both, reported the malware as a plain "High", and ignored `expires:`: a
  rule dated in the past still hid its finding, and the unknown key raised no error.
- `npm audit` (npm 11.20) found both and named the malware, but has no waiver file at all.
- `pnpm audit` (pnpm 12.16.1) has `ignoreGhsas`, which never expire, and two switches that pass a
  check that should fail: `--ignore-unfixable` and `--ignore-registry-errors`.
- Trivy 0.76.1 found both and honoured `exp:` in its ignore file. Its own release and its GitHub
  Action tags were hijacked in March 2026 (CVE-2026-33634), which is the case for the digest.

**Why:** in the npm compromises of September 2025 (TC-4), a lockfile resolved in the hours before
the malicious versions were removed kept them. A release age keeps new versions out; nothing else
looks at what the lockfile already holds, and an advisory against an old version appears with no
change to the project at all. The examples' own lockfile carried an unwaived denial-of-service
advisory in a lint dependency on the day this check was added.

**Enforced by:** Engineer — the scanner, and a check that judges its report against the waiver
file, tested by planting each refusal. Administer — the reason a waiver gives. Missing Engineer
control: reading the waiver file from the base as well, as SH-12 reads its digest list, so one
change cannot add a finding and its waiver together.

**Prior art:** OSV and the OpenSSF malicious-packages feed; npm audit; GitHub's dependency
review; the straitjacket template's expiring waivers, mirrored across two scanners.

**Example:** [`tools/vulnerabilities.ts`](../examples/tools/vulnerabilities.ts),
[`vulnerability-waivers.json`](../examples/vulnerability-waivers.json).

## Open questions

- **Formatter:** Prettier or Biome. Either works, since lint is typescript-eslint regardless;
  Biome's own linter does not go as deep on type-aware rules, so it would format only.
- **Runtime-specific permission flags:** Node's permission model (`--permission`, `--allow-fs-read`
  and friends) is the nearest counterpart of Deno's `--allow-*`, but coarser: it governs the file
  system, child processes and workers, and network access only as all or nothing, with no per-host
  grants. DE-10 asks for it, but no project under this standard has run it in production yet.
