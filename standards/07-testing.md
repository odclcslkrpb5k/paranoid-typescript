# 07 Testing

A test an agent writes from its own reading of a problem shares the agent's blind spots: it
restates the happy path the agent already believed. Most of this chapter is about making tests
prove something anyway.

## What a test may touch

### TS-1 (MUST NOT) Let the default test suite reach a live system.
The everyday suite uses fakes, scripted transports and recorded responses. A test that must touch a
live system is a separately named task, run deliberately, and with the owner's agreement for
anything beyond a test account.

**Why:** some production APIs bill every call, failures included, and have no safe sandbox; others
hold real customer data. A test that reaches one does real damage or real spending.

**Enforced by:** Engineer, by making the network unreachable rather than asking tests not to use
it: run the suite in a container on a network declared `internal` (the most portable control), or
under a runtime permission set that allows only the test database and loopback (possible in Deno;
Node's permission model grants network access only as all or nothing), or with a test browser that
resolves no hostname but its fakes' (`--host-resolver-rules`), with a test proving the block holds.

### TS-2 (MUST) Test anything whose meaning depends on SQL semantics against the real database engine, at the production version.
A fake cannot show evaluation order inside an upsert, a constraint or type refusing a value, or
what the driver hands back for a column type. Prefer a test command that starts the database (in
Docker Compose, beside the suite), so the tests always run. Where that is not possible, the
database tests live in their own directory, run by a separate task that the check command (TC-5)
always runs; never as tests that quietly skip when a variable is unset (TS-10).

**Why:** a 64-bit id that rounded to a different record (BD-4) was found in review; only a test
against the real engine could pin the fix.

**Enforced by:** Engineer — the test command starts the database.

### TS-3 (SHOULD) The suite fails a test that leaks a timer, a socket or a pool connection. (PROPOSED)
An `afterEach` (or a global teardown) asserts that every database pool is drained, no timer or
interval is pending and no server is listening.

**Why:** a leaked handle is usually a missing `await` or a missing `finally`, and in production it
is a slow resource leak or a hang on shutdown. Neither `node:test` nor Vitest fails an individual
test for a leaked handle out of the box (check your version: runners add diagnostics over time).

**Enforced by:** Engineer — the teardown assertion.

**Prior art:** Deno's test sanitizers (resource, op and exit sanitizers).

## What a test must prove

### TS-4 (MUST) A change in behaviour comes with a test that fails without it.

**Why:** a change with no test that fails without it can be undone by the next change and nothing
goes red; a test that passes either way proves nothing about the change.

**Enforced by:** Administer — a finding in review (SH-3) when missing. TS-5 checks it was true.
Missing Engineer control: the gate runs the new and changed tests against the base commit's source
and refuses unless at least one fails there.

### TS-5 (SHOULD) Mutation-test every regression test written for a review finding, and every test of a guard or checker.
Put the bug back, watch the test fail, take it out again. A tool does it, not a hand edit, and the
tool:
- runs the test on the unmutated code first, and counts a mutant as caught only when that run
  passed (a test that is already red, or a filter that selects nothing, judges no mutant);
- type-checks the mutant with the tests that will judge it, and reports a mutant that does not
  compile as its own outcome — it fails every test and would otherwise score as caught;
- counts a check that fails for a reason other than the code (the container did not start, a
  dependency could not be fetched, a signal killed it) as inconclusive;
- keeps a whole copy of each mutated file, keyed on its full path, and restores from the copy,
  never from version control, which discards uncommitted work;
- runs one mutant at a time, and nothing else reads the tree while a mutant is applied.

Judge a mutant by every test that exercises the guarded code, not only the file named after it. A
mutant behind an earlier guard that already rules its case out is equivalent and survives: record
it as equivalent, naming the guard, rather than count it caught. A mutant must be able to fail the
test at all: a locale fix tested in a harness that already clears the locale, or a "connection
refused" path aimed at a port the runtime refuses before connecting, proves nothing.

**Why:** a test written from a report restates the report's happy path. In one ship, three of six
regression tests passed with their bug reinstated. Restoring from git once discarded eight
uncommitted fixes; a basename-keyed copy restored one file over another.

**Enforced by:** Engineer for the mechanics (the tool); Administer that it is run, in the ship
cycle. Missing Engineer control: the ship tool refuses to commit a new regression or checker test
without a mutation record for it.

**Prior art:** mutation testing (PIT, Stryker), applied selectively, to the tests that matter most,
rather than across the whole codebase.

### TS-6 (SHOULD) A check that selects its own subject asserts which subject it selected.
Name the tables, routes or files it found and compare them with the set it claims to cover, in both
directions. Make an ambiguous match fail (assert exactly one match, never `.find`). A floor on the
count goes after the assertions it protects. A gate that finds no tests to run fails.

**Why:** zero findings over zero subjects is the same green as zero findings over all of them. A
floor passed twice while three of four statements went unchecked.

**Enforced by:** Administer, in review. Missing Engineer control: a lint rule refusing `.find(`
where a check selects its subjects, and a test runner setting that fails a run selecting no tests;
whether the claimed set is the right one needs review.

### TS-7 (MUST) Something fails when two files that have to agree stop agreeing.
Production permissions against the paths the container mounts; the environment variables the code
reads against `.env.example` and the README (RP-1, RP-2); SQL against the schema catalog; a
deploy's grace period against the longest unit of work a client's retries allow (DE-3). Write the
check.

**Why:** tests run with every permission, so they never see one the production command lacks. An
image once had no read permission for its own key; every test and the release check passed, and
only review caught it.

**Enforced by:** Engineer — a contract test per pair.

### TS-8 (MUST) The suite that passes is the tree being shipped.
Rebuild a test image in the same command that runs it (`docker compose run --build`), never run an
image built earlier. A suite that drives a long-running service recreates it in the same command.

**Why:** a stale image passes with the same count, colour and duration as a real run. Three green
suites in one ship ran a tree that was already red.

**Enforced by:** Engineer — the test command includes the rebuild.

### TS-9 (SHOULD) Test an outbound HTTP client against a loopback server, not only through a fake of its own interface.
Start a server on port 0, with the base URL and time budget as parameters. A handler that never
answers hangs shutdown, so answer late rather than never. A broken stream that must deliver part of
a body and then fail is built in the stream's `pull()`; erroring in `start()` delivers nothing.

**Why:** a fake of the transport leaves the transport untested. A renamed header, a dropped timeout
and a widened URL pattern all passed until the client had a loopback test.

**Enforced by:** Administer, in review. Missing Engineer control: a test that fails when an adapter
calling `fetch` has no test that starts a loopback server.

### TS-10 (SHOULD) The suite reports no skipped tests.
A test that cannot run where the suite runs — it needs git, a browser, a tool the test image lacks
— lives in its own directory, which the main run excludes and the gate runs where it can. A skip
for any other reason is folded into a test that always runs.

**Why:** "1 skipped" in every run is a test that guards nothing. One project's commit-gate test had
never run in any ship.

**Enforced by:** Engineer — the gate runs the separate directory and fails on a skip.

### TS-11 (SHOULD) A fake carries only what the real service has sent.
Record the member paths of real responses — names only, never values — and fail any fake that uses
a path outside that set, naming the path. Merge each recording into the last. A parser of a
document a vendor returns (HTML, PDF, CSV, XML) has at least one fixture shaped from a real one,
values masked or invented but structure kept: a published sample is a guess. A fixture meant to
check types holds every list non-empty and every nullable member a value, asserted.

**Why:** a fake that carries a field the service never sends passes every test while production
reads nothing. One consumer's fakes still carried fields an upstream service had stopped sending;
in production it would have flagged every record as missing data. A parser tested only on a
vendor's sample letter matched no real letter for six days.

**Enforced by:** Engineer — the shape check refuses a non-conforming fake. Higher, where possible:
the service that owns the contract publishes the recorded shape with its client (RP-5).

**Prior art:** consumer-driven contract testing (Pact), approached from the recorded side.

### TS-12 (SHOULD) Compare raw values, and classify a difference by kind.
A shadow comparison, a round trip or a migration parity check compares raw values and names each
difference's kind — outer whitespace (with both lengths), line endings, case only, null against
empty, value — without printing either value (DP-3). Then decide which kinds are accepted.

**Why:** normalising both sides hides exactly the differences it normalises. A comparison that
trimmed both sides reported agreement, and a fix built on it moved one system away from the other
while three checks said they agreed.

**Enforced by:** Engineer — the comparison classifies.

### TS-13 (SHOULD) Read every `Result` in a test through a helper that asserts it.
`succeeds(p)` returns the value or fails the test; `fails(p)` returns the error, to compare
exactly. Build fixtures through typed builders (`withFields(order, fields: Partial<Order>)`), not
untyped spreads or `Object.assign`.

**Why:** a test that awaited a call to see it not throw passes silently on a failed `Result`.

**Enforced by:** Engineer, once LN-6 exists (a discarded `Result` in a test is then an error).

### TS-14 (SHOULD) A layout test measures at the worst size the layout allows.
Set the element to the narrowest the layout permits before measuring wraps and truncation, and
assert what a reader would misread: a label broken across lines, a value cut to an ellipsis.

**Why:** a test browser's window is wider than an operator's monitor; a status tile cut `false` to
`fa…`, and the test written for it passed until it pinned the tile to its minimum width.

**Enforced by:** Administer, in review. No practical Engineer control: the narrowest size a layout
permits is a fact of its design, which no generic check knows.

### TS-15 (SHOULD) A test that proves one cause fails a check runs with only that cause present.
When a shared fixture gains a new way to fail, each older "this cause makes the check fail" test
removes every other cause from its copy of the fixture.

**Why:** otherwise the older test passes because of the new cause, and no longer tests its own.

**Enforced by:** Administer, in review. Missing Engineer control: a fixture builder that makes a
clean fixture plus exactly one named cause, so a cause's test cannot inherit the others.

## Open questions

- **Test runner:** `node:test` or Vitest. Either needs TS-3's leak check added.
