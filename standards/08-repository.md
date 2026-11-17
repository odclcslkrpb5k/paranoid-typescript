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
documented that nothing reads. Administer elsewhere. Missing Engineer control, where it is not yet
built: that contract test.

### RP-2 (MUST) `.env.example` names every environment variable the project reads.
With a comment saying what each is, and a safe default where one exists. Never a real value.

**Why:** a deployer setting up a new environment works from this file. A variable missing from it
is one the next environment forgets to set, and a real value in it is a secret in version control.

**Enforced by:** Engineer where RP-1's contract test is built, which covers this file too;
Administer elsewhere. Missing Engineer control, where it is not built: that contract test.

### RP-3 (MUST) Durable context lives in one notes file.
What was learned and cannot be read back from the code: dead ends, rejected alternatives, the full
reasoning behind a decision, what production looked like on a given date, review findings deferred.
Organized by topic, with dated entries. (`docs/notes.md` or similar; agents often keep theirs as
`docs/claude-notes.md`.)

**Why:** the comment rules (CD-1, CD-2) keep narration out of code; this is where it goes instead,
so it is kept without rotting in the source.

**Enforced by:** Administer — the ship cycle's harvest step (SH-5). Missing Engineer control: the
ship tool refuses to commit until the harvest decision is recorded (SH-5); what is worth keeping
needs judgement.

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

**Enforced by:** Administer. Missing Engineer control: a gate check that the agent instructions
link this standard and name a commit that exists in it.

### RP-7 (SHOULD) Repositories share one top-level layout.
`src/` (with `src/adapters/`, ER-3), `test/` (with `test/fakes/`), `vendor/`, `docs/`, `db/` where
there is a database (DB-5), `.env.example`, `README.md`, the agent instructions, the lockfile and
the container files. A directory a project has no use for is absent.

**Why:** an agent moving between repositories finds things where it expects them, and lint rules
that name paths (ER-3) work unchanged.

**Enforced by:** Administer. Missing Engineer control: a test that fails on a missing required path
or an unexpected top-level directory, with the project's deliberate absences listed.

### RP-8 (MUST) The repository host's settings that a control relies on are recorded in a committed file, and a check fails when the live settings differ. (PROPOSED)
Some Engineer controls in this standard live on the host, not in the tree: SH-6's block on
force-pushes, a project's required reviews, the workflow token's permissions. A settings page is
edited by hand, makes no commit and leaves no diff, so a control can silently become nothing while
every document still claims it. The file records each such setting. On GitHub that means:
- rulesets, or classic branch protection: required reviews, code-owner review, conversation
  resolution, stale-approval dismissal, last-push approval, merge methods, deletion and
  force-push blocks, bypass actors;
- the merge settings;
- the Actions policy and the workflow token's permissions, including whether workflows may
  approve pull requests;
- the security features;
- in a private repository, the access list. In a public one, leave it out or record it by team:
  the logins of people who can write are personal data, and a list of targets.

The check:
- reads the live settings through the host's API, read-only;
- normalizes them, dropping URLs and each ruleset's own id and timestamps, but keeping nested ids,
  since a required reviewer is named by one;
- compares the result with the file by content;
- exits 0 on a match, 1 on drift (printing the difference), and 2 when it could not run.

Some fields are shown only to an administrator. If one is missing, the check could not run; that
is never drift, and never a pass. A `--write` mode regenerates the file, for the change that
records a deliberate edit. A scheduled job runs the check, since a settings change makes no commit
and triggers nothing; its token can read the administrator-only fields and change nothing.

Measured on gh 2.46.0:
- `gh api` prints an HTTP error's JSON body on stdout, so a check that only tests the output reads
  an error as data. Judge the exit status first, then the shape.
- A branch with no classic protection answers 404 `Branch not protected` (exit 1), which is a
  state, not a failure.
- `vulnerability-alerts` answers 204 with an empty body when on, and 404 when off.
- `security_and_analysis` is absent from the repository object for a reader who is not an
  administrator.

**Why:** on one team's repository, a hand edit meant to turn off two ruleset settings (stale
approval dismissal and last-push approval) also turned off required conversation resolution.
Nobody meant that. The project's decision log, and the agents' shipping instructions that told
every session an unresolved thread blocks the merge, still said it held. A review agent found it
three hours later by reading the ruleset back through the API. The same day, the same reading
found an automated review on every push that had been in the ruleset all along and was recorded
nowhere.

**Enforced by:** Engineer — the check in a scheduled job, tested against recorded API answers
through a fake client, so the test never reaches the host. Until the job exists: Administer, with
the ship cycle (SH-2) running the check and reporting drift. Missing Engineer control, until then:
the scheduled job itself.

**Prior art:** configuration as code for repository settings: the Probot Settings app
(`.github/settings.yml`) and Terraform's GitHub provider (`github_repository_ruleset`,
`github_branch_protection`). Both apply settings rather than check them; either can be the record,
and a `plan` that shows changes is the same drift signal. The rule asks only that drift fails
something: a tool that applies settings needs credentials that can change them.
