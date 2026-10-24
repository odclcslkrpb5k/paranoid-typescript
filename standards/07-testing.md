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
it: run the suite in a container with no network at all (`network_mode: none`, where it needs no
other container), or on a network declared `internal` (the most portable controls), or under a
runtime permission set that allows only the test database and loopback (possible in Deno; Node's
permission model grants network access only as all or nothing), or with a test browser that
resolves no hostname but its fakes' (`--host-resolver-rules`), with a test proving the block holds.

### TS-2 (MUST) Test anything whose meaning depends on SQL semantics against the real database engine, at the production version.
A fake cannot show evaluation order inside an upsert, a constraint or type refusing a value, or
what the driver hands back for a column type. Prefer a test command that starts the database (in
Docker Compose, beside the suite), so the tests always run. Where that is not possible, the
database tests live in their own directory, run by a separate task that the check command (TC-5)
always runs; never as tests that quietly skip when a variable is unset (TS-10). Every place the
suite runs uses that engine: a fork is another engine, and so is the same engine at another major
version.

**Why:** a 64-bit id that rounded to a different record (BD-4) was found in review; only a test
against the real engine could pin the fix. One application ran MySQL on developers' machines and
MariaDB in CI, and wrote `CAST(... AS JSON)`, which MySQL accepts and MariaDB refuses as a syntax
error (MariaDB 11.8).

**Enforced by:** Engineer — the test command starts the database, and a test compares the
version the server reports with the production version pinned in the repository (TS-7).

### TS-3 (SHOULD) The suite fails a test that leaks a timer, a socket or a pool connection. (PROPOSED)
An `afterEach` (or a global teardown) asserts that every database pool is drained, no timer or
interval is pending and no server is listening. In Node, compare `process.getActiveResourcesInfo()`
before and after each test, and prove the check can fail with fixtures that leak on purpose. Judge
timers at once — a cleared timer is gone immediately, so a settling window only lets a short leak
through — and give sockets and servers a short window, both to finish closing and to appear: a
server is listed only once its `listen` completes. What it cannot see: Node reports only handles
that keep the event loop alive, so an `unref()`'d timer or socket is invisible. What it sees that
is not a leak: Node's `fetch` keeps connections open for reuse, and a test server in the same
process holds its side of each, so a server under test closes its connections (`Connection: close`)
rather than have the pool read as the test's leak.

**Why:** a leaked handle is usually a missing `await` or a missing `finally`, and in production it
is a slow resource leak or a hang on shutdown. Neither `node:test` nor Vitest fails an individual
test for a leaked handle out of the box (check your version: runners add diagnostics over time).

**Enforced by:** Engineer — the teardown assertion.

**Prior art:** Deno's test sanitizers (resource, op and exit sanitizers).

**Example:** [`test/support/leaks.ts`](../examples/test/support/leaks.ts),
[`test/meta.test.ts`](../examples/test/meta.test.ts).

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
  compile as its own outcome — it fails every test and would otherwise score as caught. Under
  `noUnusedLocals` and `noUnusedParameters` (CP-1), deleting the only use of a constant or a
  parameter fails to compile (TS6133), so write such a mutant to keep every symbol in use
  (`x || false`, `n * 0`);
- counts a mutant as caught only when a test fails, read from the test runner's own counts of tests
  that failed and tests it cancelled (`node:test` reports a test cut off by `--test-timeout` as
  cancelled, with a fail count of 0, and a mutant that makes code hang is a real kill), never from
  the exit status of a command that also formats or lints: two mutants once scored as caught while
  every test passed, one because it lengthened a line past the formatter's width and one because it
  tripped a lint rule;
- counts a check that fails for a reason other than the code (the container did not start, a
  dependency could not be fetched, a signal killed it) as inconclusive, and so judges a planted bug
  by a reason its log must show, not only by the step that failed: judged by step, a network
  failure at a dependency-audit step would have proved both the licence and the advisory controls;
- keeps a whole copy of each mutated file, keyed on its full path, and restores from the copy,
  never from version control, which discards uncommitted work;
- runs one mutant at a time, and nothing else reads the tree while a mutant is applied.

Judge a mutant by every test that exercises the guarded code, not only the file named after it. A
mutant behind an earlier guard that already rules its case out is equivalent and survives: record
it as equivalent, naming the guard, rather than count it caught. A mutant must be able to fail the
test at all: a locale fix tested in a harness that already clears the locale, or a "connection
refused" path aimed at a port the runtime refuses before connecting, proves nothing; nor does a
test runner started from inside a test to prove a check fails, if it inherits the parent's
`NODE_TEST_CONTEXT` and reports upward instead of failing.

A comment that says a line is needed for a behaviour is a claim, and is mutated like a guard:
remove the line and run the test of that behaviour. A survivor means the line goes, or the comment
does, and the test is strengthened if the behaviour is real.

**Why:** a test written from a report restates the report's happy path. In one ship, three of six
regression tests passed with their bug reinstated. Restoring from git once discarded eight
uncommitted fixes; a basename-keyed copy restored one file over another. Two lines in one ship
were "required" by their comments, a fetch that sent no `Accept` header so the browser would reuse
a preload, and a dialog closed rather than removed so focus would return; with each removed, the
tests of that behaviour still passed, and both lines went.

**Enforced by:** Engineer for the mechanics (the tool); Administer that it is run, in the ship
cycle. Missing Engineer control: the ship tool refuses to commit a new regression or checker test
without a mutation record for it.

**Prior art:** mutation testing (PIT, Stryker), applied selectively, to the tests that matter most,
rather than across the whole codebase.

### TS-6 (SHOULD) A check that selects its own subject asserts which subject it selected.
Name the tables, routes or files it found and compare them with the set it claims to cover, in both
directions. Make an ambiguous match fail (assert exactly one match, never `.find`). A floor on the
count goes after the assertions it protects. A gate that finds no tests to run fails. A
third-party checker is such a check: its exit status says nothing about what it read, so the gate
parses its report and compares the files it says it checked with the build's own list.

**Why:** zero findings over zero subjects is the same green as zero findings over all of them. A
floor passed twice while three of four statements went unchecked. A static analyzer given a
directory where it expected a project file checked nothing and exited 0; another exited 0 with
findings whenever it was asked for machine-readable output; a package index update that failed to
download exited 0, and the install went ahead from stale indexes. In CI, the same green came from
an approval label that made an end-to-end gate skip its four shards in fifteen seconds and report
success, and from an advisory job whose steps were all allowed to fail, which reported success for
two days while dead.

**Enforced by:** Administer, in review; Engineer where the gate compares a tool's report with the
build's file list. Missing Engineer control: a lint rule refusing `.find(` where a check selects
its subjects, and a test runner setting that fails a run selecting no tests; whether the claimed
set is the right one needs review.

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
- **A cache is an image too.** Every cache of build or test output (a test runner's transform
  cache, a bundler's persistent cache, a CI cache restored across runs) keys on every input that
  changes that output: the transform's configuration files, the transformer's own version
  (including a peer dependency its loader does not declare), and the lockfile. A CI cache with a
  bare fallback key restores output built from other inputs.
- **So does every path filter** that decides whether a check runs. A filter that misses a
  configuration file skips the check on a change to that file, and the check reports success.
- **A test enumerates the build's configuration files** and fails when one is missing from a cache
  key or a path filter, and a planted change to the configuration must change the output (CP-3).
- **Two trees never share a build cache.** A copy of the tree (a planted bug, a mutant, a second
  checkout) builds into a cache inside itself, and the gate sets that location rather than
  inheriting one from the environment: a cache that names its outputs by a relative path and judges
  them fresh by modification time takes a copy's output for the tree's own.

**Why:** a stale image passes with the same count, colour and duration as a real run. Three green
suites in one ship ran a tree that was already red. One change that moved a frontend's compiler
settings into the transformer's own configuration file found four instances of the same hole:
- the test runner's transform cache ignored that file, so tests ran on output compiled under the
  old settings;
- the bundler's persistent cache tracked neither that file nor the transformer, and CI restored
  it from a key on the lockfile alone, so the build would have shipped modules compiled under the
  old settings;
- the unit tests' path filter omitted the file, so a change to it alone would have skipped the
  required check;
- the component catalogue's deploy filter listed only JavaScript and `package.json`, so it had
  never redeployed for a TypeScript-only change.

Review found all four; no check could have.

A project whose plant runner copied the tree for each planted bug shared one Rust build directory,
set by its image, between the copies and the tree. Cargo names a workspace member's outputs by its
path within the workspace, the same in every copy, and the tree's own test run reused a test binary
built from a plant: on cargo 1.99.1, with `CARGO_TARGET_DIR` shared, the tree's `cargo test` failed
on the copy's planted assertion, and passed with a directory of its own. The other direction, a
tree passing on a stale passing binary, is the one that ships. A mutation tool that copied the tree
inherited the same setting.

**Enforced by:** Engineer — the test command includes the rebuild; the enumeration test and the
planted change for caches and filters.

**Prior art:** hermetic builds (Bazel), whose action keys cover every declared input by
construction.

### TS-9 (SHOULD) Test an outbound HTTP client against a loopback server, not only through a fake of its own interface.
Start a server on port 0, with the base URL and time budget as parameters. A handler that never
answers hangs shutdown, so answer late rather than never. Run the suite with a per-test timeout: a
deadline regression makes a test hang rather than fail, and without one the run waits for the CI
job's own limit. A broken stream that must deliver part of a body and then fail is built in the
stream's `pull()`; erroring in `start()` delivers nothing.

**Why:** a fake of the transport leaves the transport untested. A renamed header, a dropped timeout
and a widened URL pattern all passed until the client had a loopback test.

**Enforced by:** Administer, in review. Missing Engineer control: a test that fails when an adapter
calling `fetch` has no test that starts a loopback server.

**Example:** [`test/http.test.ts`](../examples/test/http.test.ts).

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

**Example:** [`test/support/assert.ts`](../examples/test/support/assert.ts).

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

### TS-16 (SHOULD) Every parser and brand parse function has property-based tests. (PROPOSED)
Generate inputs rather than only writing them: arbitrary JSON, wrong types, extreme and special
numbers (`NaN`, `-0`, `2**53`), long and unusual strings (lone surrogates, control characters,
hidden characters), deep nesting. Assert the properties that must hold for every input: the parser
never throws and always returns a `Result` (ER-1); everything a generator of valid values produces
is accepted; and where there is a serializer, parsing what it wrote gives back the same value. Keep
each failing case the tool finds as an ordinary fixture.

**Why:** a fixture written by hand covers the cases its author thought of, and an agent thinks of
the same ones each time. Recorded fixtures (TS-11) cover what real systems send; mutation testing
(TS-5) measures whether the tests catch bugs. Generated inputs cover what neither does: the input
nobody imagined.

**Enforced by:** Engineer — the property tests, with a fixed seed in CI and a varying one in a
scheduled run that records its seed, so any failure reproduces. Missing Engineer control: a test
that fails when an exported parse function has no property test.

**Prior art:** QuickCheck (Koen Claessen and John Hughes, 2000); fast-check for TypeScript.

**Example:** [`test/builtins.test.ts`](../examples/test/builtins.test.ts),
[`test/ids.test.ts`](../examples/test/ids.test.ts).

### TS-17 (SHOULD) An end-to-end assertion on a value the UI derives from server state also reads that value from the server. (PROPOSED)
The test asserts the value through the API as well as on screen, and its expected value comes from
the server's rule, not from what the UI happened to show when the test was written.

**Why:** an end-to-end test demoted a project lead and expected that person's task count to stay at
one. The server had always unassigned a demoted member's tasks, so the true count was zero. The
test passed for months only because the table never refetched after the change and kept showing a
stale count. When an unrelated backend change made the table refetch, the test failed on every
change, against the main branch's own frontend and backend. The test had been certifying a stale
cache as correct behaviour. The server's own responses in the trace showed the real state at every
step; an assertion against them would have caught it the day the test was written.

**Enforced by:** Administer — review of end-to-end tests. Missing Engineer control: a test helper
that pairs each assertion on server-derived text with an API read of the same value, so an
assertion on screen text alone stands out.

### TS-18 (SHOULD) The suite fails a test whose code emits a warning.
The test setup records every warning the runtime, a framework or a library emits (`console.warn`,
`console.error`, Node's `process.on("warning")`), and fails the test in `afterEach`, not by
throwing from the warning call. Deliberate warnings are allowed by exact text, in one list. A
self-test pins each recorded text, so a library that rewords a message cannot silently turn the
check off (TS-6).

**Why:**
- **A framework's development-mode warning is a defect report.** It reports a missing list key, a
  state update outside the test's control, an input switching from uncontrolled to controlled, or a
  selector returning a new object for the same input. On a large frontend, that selector warning
  was the only sign of a fallback (`state.x?.[id] ?? []`) that re-rendered on every store change.
- **Fail afterwards, not from inside the call.** A throw from inside `console.warn` during a render
  is caught by the nearest error boundary, which renders its fallback, and the test passes (React
  19.3).
- **The same capture, earlier.** That codebase's end-to-end console capture found 279 plain-object
  throws (ER-3) and 48 floating promises (LN-4). Failing the unit suite on the same output moves
  such findings to the cheapest test.

**Enforced by:** Engineer — the test setup and its self-test.

**Prior art:** pytest's `filterwarnings = ["error"]`; compilers' warnings-as-errors.

### TS-19 (SHOULD) A wait that gives up keeps what it was waiting for. (PROPOSED)
A helper that races a read against a timeout (`Promise.race([reader.read(), timeout])`) leaves the
read pending when the timeout wins. The next wait's read queues behind it, and whatever the orphan
resolves with is lost. Keep the pending read with the stream's state and hand it to the next wait
(`seen.waiting ??= reader.read()`, cleared once it resolves). The alternative is to cancel the
read, which only works when nothing the stream sends afterwards matters. The same holds for any
pending operation that consumes what it receives: a queue pop, a socket read, a lock request.

**Why:** a test that waited for a live feed's first message, gave up, and then waited for the next
timed out on data that had already arrived. It looked like an intermittent server bug: about one
full run in two failed, at the previous commit as well. On Node 24.22, a stream sent one chunk
after a 50 ms wait gave up; a second raced read then timed out, while a helper that kept the
pending read got the chunk.

**Enforced by:** Engineer — the helper, with a test that sends after one wait has given up and
asserts that the next wait sees it, mutation-tested against the racing form (TS-5).

**Prior art:** Tokio's "cancellation safety" of the operations `select!` may drop; Go's `select`,
whose receive takes nothing when another case wins.

## Open questions

- **Test runner:** `node:test` or Vitest. Either needs TS-3's leak check added. The examples use
  `node:test`: it ships with the runtime and needs no dependency (TC-7). Its cost is configuration:
  LN-4's `allowForKnownSafeCalls`, and wrappers for tools that expect callback-style hooks.
