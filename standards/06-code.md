# 06 Code

## Comments

An agent explains itself, and left alone it explains in comments: what it changed, what the code
used to do, which bug this fixes. That is real context, but it expires the moment the change
merges. The defect it describes no longer exists, so the comment becomes a story about a problem no
future reader can observe: a changelog entry in the wrong file. The commit message is where it
belongs (SH-8); the durable notes file (RP-3) takes the rest. `docs/` is exempt from CD-1 to CD-3.

### CD-1 (MUST NOT) Write a comment that narrates the diff: the code's history, a fix, a defect.
Tells: "was", "now", "previously", "this fixes", "no longer", "used to be", "changed to". "X
instead of Y" is fine when it states a present, durable trade-off rather than what the code used to
do.

**Why:** an agent writes these by default, and each one is true for a day and misleading after:
"now retries three times" reads, a year later, as if retrying were new.

**Enforced by:** Engineer, partly: a checker for the unambiguous tells, run as an edit-time hook
and in the check command (TC-5). Administer for the rest (CD-2). No practical Engineer control for
it: telling a durable trade-off from history needs the comment read against the code.

### CD-2 (MUST) Every comment passes the survival test.
Would it still be true and useful to someone reading the file in a year, who never saw the diff? If
it only makes sense beside the diff, it belongs in the commit body. Default to short comments that
state a non-obvious *why*: an external constraint, a required manual step, an invariant the code
cannot show. A paragraph belongs in `docs/`. Declarative configuration (compose files, CI YAML) is
self-describing and takes none, unless it has such a constraint.

**Why:** a comment no one needs is still read by everyone, and an agent reads every one as
instruction. The comments worth keeping carry what the code cannot: why it is this way.

**Enforced by:** Engineer for the listing: a script lists every comment line a change adds (added
lines holding a comment marker). Administer for the judgement: re-read each listed line before
committing; each one must pass on its own, and deleting is always acceptable. "It is only one line"
and "this one is genuinely useful" are not exemptions; the second is the thought that precedes
every violation. No practical Engineer control for the judgement: whether a comment will still be
true and useful in a year needs a reader.

### CD-3 (MUST) When a change makes a comment false, delete it rather than rewrite it into a new narrative.

**Why:** a rewritten comment tends to carry the old story forward ("no longer does X"); a deleted
one cannot.

**Enforced by:** Administer, in review. The listing in CD-2 shows edited comment lines too. No
practical Engineer control: telling a rewrite that narrates from one that states the present needs
a reader; CD-1's checker catches the plain tells.

### CD-4 (RETIRED 2026-10-14: folded into CD-2's Enforced by, which it restated.)

## Side effects

### CD-5 (MUST) Read everything a decision needs before the first write it makes.

**Why:** a read that fails after a write leaves a record half changed.

**Enforced by:** Administer, in review. Where the reads and writes go through facades (CD-6), a
test double can assert the order. Missing Engineer control: a test double behind the facades that
records reads and writes in order and fails when a decision reads after its first write.

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
