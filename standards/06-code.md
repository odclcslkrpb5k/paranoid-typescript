# 06 Code

## Comments

An agent explains itself, and left alone it explains in comments: what it changed, what the code
used to do, which bug this fixes. That is real context, but it expires the moment the change
merges. The defect it describes no longer exists, so the comment becomes a story about a problem no
future reader can observe: a changelog entry in the wrong file. The commit message is where it
belongs (SH-8); the durable notes file (RP-3) takes the rest. `docs/` is exempt from CD-1 to CD-4.

### CD-1 (MUST NOT) Write a comment that narrates the diff: the code's history, a fix, a defect.
Tells: "was", "now", "previously", "this fixes", "no longer", "used to be", "changed to". "X
instead of Y" is fine when it states a present, durable trade-off rather than what the code used to
do.

**Enforced by:** Engineer, partly: a checker for the unambiguous tells, run as an edit-time hook
and in the gate (SH-10). Administer for the rest (CD-2).

### CD-2 (MUST) Every comment passes the survival test.
Would it still be true and useful to someone reading the file in a year, who never saw the diff? If
it only makes sense beside the diff, it belongs in the commit body. Default to short comments that
state a non-obvious *why*: an external constraint, a required manual step, an invariant the code
cannot show. A paragraph belongs in `docs/`. Declarative configuration (compose files, CI YAML) is
self-describing and takes none, unless it has such a constraint.

**Enforced by:** Administer — re-read every comment line a change adds before committing; each one
must pass on its own, and deleting is always acceptable. "It is only one line" and "this one is
genuinely useful" are not exemptions; the second is the thought that precedes every violation.

### CD-3 (MUST) When a change makes a comment false, delete it rather than rewrite it into a new narrative.

**Enforced by:** Administer, in review.

### CD-4 (SHOULD) Re-read the comments a change adds with a tool's help.
List them before committing (`git diff --cached` filtered to added lines that hold a comment
marker) and judge each against CD-2.

**Enforced by:** Engineer for the listing; Administer for the judgement.

## Side effects

### CD-5 (MUST) Read everything a decision needs before the first write it makes.

**Why:** a read that fails after a write leaves a record half changed.

**Enforced by:** Administer, in review. Where the reads and writes go through facades (CD-6), a
test double can assert the order.

### CD-6 (MUST) Every write to an outside system goes through one facade per system.

**Why:** it is what makes a shadow mode (SV-6), a dry run or a test double possible without a code
path that bypasses it.

**Enforced by:** Engineer, with ER-3: only the adapter may import the system's client, and the
facade is the adapter's only export for writes.

## Source hygiene

### CD-7 (SHOULD) A hidden character in source is written as an escape, and a test fails on a literal one.
No-break spaces, zero-width characters, bidirectional controls and line or paragraph separators
appear in source only as escapes (`\u00a0`). Where text needs one, build it or write the escape.

**Why:** an agent's edits travel as JSON, which decodes `\uXXXX` before the text reaches the file.
`\u00a0` typed into an edit lands as a literal no-break space, invisible in review; `\u2028` in a
regular expression lands as a line terminator, a syntax error. ESLint's `no-irregular-whitespace`
skips string literals by default, which is where most of these land, and a line terminator inside a
regex is a parse error before any rule runs.

**Enforced by:** Engineer — a test that scans the repository's source for literal hidden
characters, and a script that rewrites them as escapes.

**Prior art:** the "Trojan Source" bidirectional-text attacks (CVE-2021-42574) are the hostile
version of the same blindness.
