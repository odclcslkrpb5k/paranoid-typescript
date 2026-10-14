# 10 Shipping

How a change goes from an agent's working tree to the main branch. The cycle is the same whether a
person or an agent drives it; the rules exist because an agent drives it many times a day, and a
step that depends on someone remembering fails exactly when attention is elsewhere.

**Build the ship tooling as code, from day one.** The rules below were first written as prose and
copied into each project's scripts by hand; three rounds of prose patches in four days, each
hand-copied into four repositories, is the lowest rung of the ladder chasing the highest. Keep one
ship tool, owned by one repository, vendored (RP-4) and configured per project, with its own tests.
The detailed rules in this chapter are then requirements on that tool and the tests it must pass.

## The cycle

### SH-1 (SHOULD) An agent commits and pushes only when authorized, and an authorization covers one cycle.
Passing checks, an approved plan or "looks good" are not authorization. Where a person grants
standing permission to push, the project's agent instructions record it.

**Enforced by:** Administer — the ship skill or instructions.

### SH-2 (MUST) The cycle is: test, review, harvest, commit and push, learn.
Time each step and report the timings. Review is the costly step and the least worth repeating:
give it the whole diff once, fix everything, then re-run the tests rather than review again —
unless a fix restructures control flow, touches authentication or credentials, or changes a release
or deploy script; then review that fix's delta alone. A rehearsal of a release script's affected
paths (DE-9) may stand in for that review.

**Enforced by:** Administer — the ship skill. Engineer for the order of the final steps (SH-10).

### SH-3 (MUST NOT) Ship unreviewed code.
Review has two parts every time: the coercion pass (BD-2), then a review agent given the whole
diff, the project's agent instructions, README and known hazards, asked for correctness bugs first,
each with a concrete failure scenario. Every finding is fixed, or disputed in the ship report with
a reason — never dropped silently. Real but out-of-scope findings go to the notes (RP-3).

**Why:** self-review misses what the author assumed. Nearly every ship's review has found at least
one real defect.

**Enforced by:** Administer — the ship skill.

### SH-4 (SHOULD) Review with several agents, on different models, each with its own brief.
Three briefs matter: housekeeping (the comment rules, prose, debris); correctness (bugs first, each
with a failure scenario, plus the coercion pass); and coherence (where one artifact contradicts
another — a doc against the code, a test's name against what it asserts, a plan against its
implementation). A finding two reviewers raise independently is likely real; where two disagree,
measure rather than pick one.

**Why:** each brief finds what the others miss. On one ship the correctness review found a cached
clock refusal and the coherence review found a guide claiming every response was JSON; neither
found the other's.

**Enforced by:** Administer — the ship skill.

### SH-5 (MUST) Harvest before committing: decide, every ship, what goes into the notes (RP-3).
"Nothing durable this ship" is a valid outcome if it is a decision, not a skipped step.

**Enforced by:** Administer; Engineer where the ship tool records the decision.

### SH-6 (MUST NOT) Force-push, rewrite pushed history, or skip hooks.

**Enforced by:** Engineer — branch protection on the remote where it is available.

### SH-7 (MUST) Report what was checked, not "it works".
Name the tests that ran, what was skipped and why, and which live systems were or were not
exercised. A service that cannot run end to end off its server is never reported as working.

**Why:** of the reporting rules, this is the one that most often separated a real result from a
plausible one.

**Enforced by:** Administer.

### SH-8 (MUST) The commit message carries the narration comments may not.
Subject in the imperative; the body says why, what it enables and what it rules out.

**Enforced by:** Administer.

### SH-9 (SHOULD) After the push, decide what the standard could learn from the ship.
A trap any project could hit, a control that closes a gap in a rule, rule text the ship showed to
be wrong or ambiguous. If nothing qualifies, the report says so in one line; if something does, it
goes to whoever keeps the standard, with its evidence.

**Why:** lessons reached the standard only when someone asked for them.

**Enforced by:** Administer; Engineer where the ship tool refuses to start the next ship while the
last one's decision is unrecorded.

## The gate

### SH-10 (SHOULD) Ship only the tree the checks passed against, proven by its hash.
Every check runs through a wrapper that records the git tree it ran against, at its start and its
end. A check whose tree changed while it ran is stale. The commit step takes the tree hash as a
required argument, hashes the tree again itself, and refuses unless both match and the latest run
of the gate and of the full suite each passed against it from start to finish. It also refuses
unless HEAD is the remote's main branch (or, resuming after a failed push, its one non-merge child
already holding that tree). Every edit — the harvest and the review fixes included — comes before
those final runs. Requirements the tool must meet, each learned from a hole a review found:
- Compute the tree in a scratch index seeded with `git read-tree HEAD`, then `git add -A`. Never
  seed it with a copy of the real index: git trusts a copied entry's size and modification time, so
  a same-size edit made in the same second hashes as the old content. Never export the scratch
  `GIT_INDEX_FILE` to anything else.
- Name the remote ref in full (`refs/remotes/origin/main`): a local branch called `origin/main`
  resolves first.
- Run under `LC_ALL=C`, and read file names with `-z`: under a UTF-8 locale a `grep -z` over file
  names skips a Latin-1 one, and without `-z` git quotes a non-ASCII path so no pattern matches it.
- Where a pre-commit hook makes a check, refuse unless the hook is enabled and executable (git
  skips a non-executable hook with only a warning), and run every check the hook makes in the gate
  too, over everything added since the remote's main: a commit made with `--no-verify` was never
  judged.
- Judge the commit message with the secrets check (SH-12); no gate reads a message.
- Read any configuration that weakens or selects checks from the remote's main as well as from the
  tree, and hold the change to both: a commit that drops a check from the tree's config is still
  held to it.
- Guard the push itself: compare `url.*.insteadOf` configuration before and after the commit (a
  hook can redirect the push to a decoy), push `"$sha^{commit}"` (a tag named after the hash
  shadows it), set `GIT_NO_REPLACE_OBJECTS=1`, and refuse more than one push URL.
- A refusal after the commit never says nothing was committed or pushed: the commit may already be
  on the remote, and a person told otherwise may reset a public commit.
- Print the diff from the tree the review saw, so the report names what shipped unreviewed (SH-2
  allows fixes without a second review).

**Why:** a full suite ran while the agent edited the release script it tested; the run passed, and
only memory said it no longer counted.

**Enforced by:** Engineer — the ship tool, with a test per requirement, mutation-tested. Known gap:
an edit made and undone during a run is not seen. The next rung, if that ever lets an unchecked
tree through, is Eliminate: run the final checks against a snapshot the agent cannot edit.

### SH-11 (SHOULD) Judge every check by its exit status, and run commit, push and release as one script that stops at the first failure.
Never read a verdict from filtered output: `check | tail -1` replaces the status with `tail`'s.
Lint, formatting, type checking, the hook's checks and the host-only tests (TS-10) run from one
gate script. Commit, push and release run from another, which on a second run resumes from
whichever step already happened. A finding and a crash never share an exit status: a checker that
exits 1 for a finding cannot be told from a runtime that exits 1 on an uncaught exception, so
findings get their own code.

**Why:** `lint | tail -1` showed "Checked 247 files" with the error above it, twice in one session;
`gate | tail && git commit` shipped a failing test; a commit joined to a release with `;` was
refused by its hook while the release ran anyway, restarting a service for nothing.

**Enforced by:** Engineer — the two scripts.

### SH-12 (MUST) Scan what is pushed for secrets and sensitive data.
Patterns for shaped secrets (cloud keys, private-key bodies, passwords in URLs, the project's own
token prefixes); and, for secrets with no recognisable shape, a committed list of SHA-256 digests
of known high-entropy values, matched against the hash of every run of token characters in an added
line. Never list a low-entropy value: a digest lets anyone confirm a guess at it. The scanner reads
the digest list from the base as well as the tree (so one change cannot delete a digest and add its
value), and reads an allow list the inverse way (an entry counts only when both base and tree hold
it). It scans the commit message too. Requirements the tool must meet:
- Follow each hunk's line counts in a unified diff: an added line that reads `++ token` appears as
  `+++ token`, and one taken for a file header is never scanned. Better, take file names from `git
  diff --name-only -z` and diff each file alone, since git quotes or tab-suffixes unusual paths.
- Diff with `--text` and grep with `-a`, under `LC_ALL=C`: after the first byte that is not UTF-8,
  git prints "Binary files differ" and grep "binary file matches", and every line after it passes
  unscanned while the gate reports clean.
- Write a token's prefix rule as a lookbehind, not `\b`: no word boundary falls between `bot` and
  the digits of `bot<id>:<token>`, or after the `_` of `KEY_AKIA...`.
- Keep placeholder rules case-sensitive: `[A-Z_]+` under the `i` flag matches every word, so a
  letter-only password passes. Make the user part of a URL-password rule optional
  (`redis://:pw@host`).
- Test that the scanner can fail: put the invalid byte inside the secret's value, under a UTF-8
  locale the script must override.

**Why:** a scan whose hits a person reads finds what that person notices. Each requirement above is
a hole a review found in a scanner that was already in use.

**Enforced by:** Engineer — the scanner, in the hook and the gate. Patterns do not find personal
data; that stays with review (DP-1).

### SH-13 (SHOULD) The steps a ship needs are read from the paths it changes, as data.
Which suites a change calls for — end-to-end tests for anything a screen depends on, a deploy
rehearsal for a change to deploy files — is kept as data: a pattern over changed paths, the step's
label and its exact command. The commit step diffs the remote's main against the shipped tree and
refuses unless the latest run of every matching step passed against that tree. It fails closed: an
invalid pattern or malformed line refuses the ship; the rules are read from the remote as well as
the tree, so one ship cannot drop the step it needs; a rename lists both names.

**Why:** a table of which suites to run, applied from an agent's memory, was skipped. Its first
encoding failed open four ways — an invalid regex counted as no match, a last line without a
newline was skipped, the file could edit away its own rule, a rename hid the old path.

**Enforced by:** Engineer — the ship tool.

## Shell scripts

Ship and deploy tooling is often shell, and shell fails open in ways that look like success. These
were each met in a real script.

### SH-14 (SHOULD) Ship and deploy scripts run strict, isolated bash.
- `#!/usr/bin/env -S bash -p` and `set -eEuo pipefail`. `-p` imports no exported functions and
  reads no `BASH_ENV` (a function named `command` outranks the builtin). `-E` carries the `ERR`
  trap into functions; without it, an error inside one exits with its own status, so a grep regex
  error reads as 1, a finding.
- Under `set -e`, a command whose failure must stop the script never sits left of `&&` or `||`,
  where bash exempts it: in `git read-tree HEAD && git add -A`, a failed `read-tree` is skipped and
  a stale index hashed. Group the chain and end it with an explicit `die`.
- Under `pipefail`, read a log to its end (`grep >/dev/null`, not `grep -q`): `grep -q` quits at
  the first match, the writer upstream dies of SIGPIPE, and a real failure reads as something else.
- `unset CDPATH`: with it set, `cd` may print the directory it chose, and `$(cd "$d" && pwd)`
  returns two lines. Test by the relative path the ship uses, since `cd` ignores CDPATH for an
  absolute one.
- Resolve paths physically (`cd -P`), and keep a command substitution's trailing newline when it
  matters (`pwd; printf x`): a directory name ending in a newline forged a ledger entry.
- Change to the repository's top before using git pathspecs, which are relative to the working
  directory: a helper run from its own directory listed nothing and reported clean.
- Run commands that come from configuration through `env --`, and give each gate step `</dev/null`,
  so a step that reads stdin cannot swallow the rest of a `while read` loop.
- A check typed into an agent's interactive shell is not the check a script runs: there `grep` may
  be an alias or function with other defaults (skipping binary files, obeying gitignore).

**Enforced by:** Engineer — each item has a test in the tool's suite, mutation-tested (TS-5).
