# 08 Repository

### RP-1 (MUST) `README.md` says how to run, configure, deploy and operate the project.
Configuration lists every environment variable, what it is, and where it is set in each
environment. Operating lists what an operator can do to the running service and where to watch it.
Where a deployment passes variables through a file such as a compose file, a setting that file pins
or never passes cannot be changed from the environment, and the README says so rather than listing
it as if it could.

**Why:** one service's first list named settings an operator would have set to no effect, and one
the code read but nothing used.

**Enforced by:** Engineer, where built: a contract test derives the settings from the code, the
compose files, the deploy scripts and the CI workflows, and fails on one undocumented or one
documented that nothing reads. Administer elsewhere.

### RP-2 (MUST) `.env.example` names every environment variable the project reads.
With a comment saying what each is, and a safe default where one exists. Never a real value.

**Enforced by:** Engineer — the same contract test as RP-1.

### RP-3 (MUST) Durable context lives in one notes file.
What was learned and cannot be read back from the code: dead ends, rejected alternatives, the full
reasoning behind a decision, what production looked like on a given date, review findings deferred.
Organized by topic, with dated entries. (`docs/notes.md` or similar; agents often keep theirs as
`docs/claude-notes.md`.)

**Why:** the comment rules (CD-1, CD-2) keep narration out of code; this is where it goes instead,
so it is kept without rotting in the source.

**Enforced by:** Administer — the ship cycle's harvest step (SH-5).

### RP-4 (MUST) Vendored code is copied, never edited, with its provenance recorded.
Code shared between your own repositories that is not published as a package is copied into
`vendor/<name>/` unchanged, with a manifest naming its source repository, path and commit, and a
hash of every file. Update by copying again. A fix goes to the owner, never into the copy.

**Why:** a diff against upstream stays empty, so an update is a copy rather than a merge, and a fix
goes to the one place every consumer gets it from. A formatter once descended into a vendored
directory and rewrote twenty files; nothing noticed until the manifest existed.

**Enforced by:** Engineer — a test that fails on any vendored file that differs from the manifest,
is missing, or is not listed, comparing each file's mode as well as its content (a script copied
without its executable bit passes a content check, and then cannot run). It needs no upstream
clone, so it runs in every test run. Where an upstream clone is available, a check that compares
each file with upstream at the recorded commit complements it.

### RP-5 (SHOULD) The owner of a protocol publishes its client, and tests its own server against it.
Self-contained, with the fewest dependencies, and with distinct failure modes: a credential
problem, a refusal and an unreachable server are different errors. The owner's suite runs its
server against the client consumers use, not a second copy written to agree with it. The client
exports the protocol's branded types (BD-5).

**Why:** consumers vendor or install it; a client tested only by its consumers breaks them all at
once.

**Enforced by:** Engineer — the owner's tests import the published client.

### RP-6 (MUST) The project's agent instructions name this standard, the commit it last conformed to, and its deviations.
Each deviation with its reason. Link to rules; do not copy them.

**Why:** copied rules drift.

**Enforced by:** Administer.

### RP-7 (SHOULD) Repositories share one top-level layout.
`src/` (with `src/adapters/`, ER-3), `test/` (with `test/fakes/`), `vendor/`, `docs/`, `db/` where
there is a database (DB-5), `.env.example`, `README.md`, the agent instructions, the lockfile and
the container files. A directory a project has no use for is absent.

**Why:** an agent moving between repositories finds things where it expects them, and lint rules
that name paths (ER-3) work unchanged.

**Enforced by:** Administer.
