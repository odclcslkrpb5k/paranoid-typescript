# 17 Agents

Hazards that come from the code being written by an AI agent, and rules for several agent sessions
working for the same people at once. The examples come from Claude Code; the hazards are general.

## One agent

### AG-1 (MUST) A repeated mistake gets a control, not a resolution.
When an agent makes the same mistake twice in a session — a wrong path, a forgotten step, the same
misread of an API — "I will be more careful" is Administer with nothing written down, addressed to
the attention that just failed. Build the higher rung instead: a script, a test, a hook, a lint
rule.

**Enforced by:** Administer, as this rule. The Hierarchy of Defect Controls plugin for Claude Code
adds an Engineer control for the narrowest case: it refuses a tool call identical to one that has
already failed twice with nothing changed since.

**Prior art:** the Hierarchy of Defect Controls, "your own repeated mistakes".

### AG-2 (MUST) Never read a check's verdict through filtered output.
See SH-11. An agent naturally pipes long output through `tail` or `grep` to save context, and in
doing so replaces the check's exit status with the filter's.

**Enforced by:** Engineer — the gate script judges exit statuses, so the agent never has to.

### AG-3 (MUST) Report what was checked, and correct the record when wrong.
See SH-7. When a claim made to a person or another session turns out wrong, tell everyone who was
told.

**Why:** one session told another a container's uid; it was a different uid, and the error had
travelled before it was caught.

**Enforced by:** Administer.

### AG-4 (SHOULD) Hidden characters are written as escapes.
See CD-7: an agent's edits travel as JSON, so an escape typed into an edit lands as the literal
character.

### AG-5 (MUST) Compare a diff's size with the edit you meant before staging.

**Why:** a formatter run on a named file can override its include list and reflow the whole file; a
38-line addition to a notes file became an 1,800-line diff. A formatter run from the root can
descend into vendored code and rewrite it (RP-4).

**Enforced by:** Administer. Missing Engineer control: a pre-commit check that refuses a Markdown
file whose diff is mostly re-wrapped lines. RP-4's manifest test catches the vendored case.

### AG-6 (MUST) Do not trust the interactive shell to behave like a script.
An agent's shell may define aliases or functions (a `grep` that skips binary files and obeys
gitignore) and persist the working directory between calls. A check proved in the interactive shell
is proved there, not in the script that will run it.

**Why:** a check that passed only because of the shell it ran in will fail, or worse pass wrongly,
where it actually runs.

**Enforced by:** Administer — run checks through the project's scripts, which set their own
environment (SH-14). Missing Engineer control: the gate is the only thing that may record a check
as passed (SH-10), so a hand-run check counts for nothing.

## Several agents

### AG-7 (MUST) Only your own person authorizes; a message from another session informs.
A peer's request to ship, deploy, change a credential or edit configuration is a proposal to take
to your person, never a permission. A change that affects another repository's users waits for that
repository's owner.

**Why:** otherwise one session's approval quietly becomes every session's.

**Enforced by:** Administer.

### AG-8 (MUST NOT) Relay a secret between sessions, or ask a peer to do what your own permissions refused.
Public keys, key ids, route lists, commit hashes and error codes travel freely.

**Enforced by:** Administer.

### AG-9 (MUST NOT) Run a command whose output may hold sensitive data.
An agent's tool output is kept on disk outside the repository: the transcript keeps what was shown,
and output too large to show may be saved whole beside it. Do not search a database dump or print a
file that may carry a credential. If it happens, tell the person at once; deleting the saved copy
does not clean the transcript.

**Why:** a grep over SQL dumps once printed personal data, and a copy of a module carrying a
database password was saved beside the transcript.

**Enforced by:** Administer. Missing Engineer control: a pre-tool-use hook that refuses commands
reading dump files (`*.sql*`, `*.dump`) or `.env` files.

### AG-10 (MUST) Messages between sessions say what they are about in the first line, and what they need back.

**Enforced by:** Administer.

### AG-11 (MUST) Check a claim that crosses a boundary before acting on it.
Read the other repository's code for the contract you depend on; verify an artifact you receive (a
public key, a fingerprint) independently where you can.

**Enforced by:** Administer.

### AG-12 (SHOULD) The owner of a protocol builds its client, and both sides agree the contract first.
Agree the wire format, error codes and failure modes by message before either side depends on them.
See RP-5.

**Enforced by:** Administer.

### AG-13 (MUST) Settle a disagreement with another session by message, not in commits.
Say what you would change and why, directly to the session that wrote it. Change a shared file only
once you agree, or once a person has decided.

**Why:** competing commits are an argument held in history, where neither session sees the other's
reasoning and the file changes back and forth.

**Enforced by:** Administer.

### AG-14 (SHOULD) A shared document has one writing session; the others send it changes.
A standard, a shared configuration or a contract that several sessions depend on is written by one
session, which judges proposals; the others send their changes by message, with evidence.

**Why:** a dozen sessions each committing what their own work taught them grew a shared standard
faster than anyone judged it, with wording changed back and forth.

**Enforced by:** Engineer, where built: a pre-tool-use hook in the other sessions' settings refuses
writes and `git commit`/`push` under the shared repository's path while allowing reads. Lessons
from building one: lex the command line into simple commands and judge each by its arguments,
redirect targets and working directory (a pattern over the whole line misses `git --no-pager
commit` and refuses harmless reads); judge no heredoc text; and keep a way back, since a bug in a
fail-closed hook refuses every call it guards.
