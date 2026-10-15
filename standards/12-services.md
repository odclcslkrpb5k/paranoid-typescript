# 12 Services

How a long-running service behaves: a background worker that drains a queue, or an HTTP service
that answers requests. And how it treats the other systems it calls.

## Starting and stopping

### SV-1 (MUST) Read and validate all configuration at boot, and refuse to start on anything missing or malformed, naming every problem at once.
One schema for the whole configuration (BD-1), parsed before anything else runs. A mode or flag is
one of its exact values.

**Why:** a misconfigured deployment should stop, not degrade. A silent default is found weeks
later. Naming every problem at once saves a deploy-fix-deploy loop per problem.

**Enforced by:** Engineer — the configuration parser, with tests.

**Prior art:** the Twelve-Factor App's configuration in the environment, made strict.

### SV-2 (SHOULD) A new setting's default never stops a deployment that was valid before it.
When a new setting must agree with an existing one, derive its default from the existing one rather
than fixing a number, and refuse only what an operator set explicitly.

**Why:** a fixed default that contradicts a value someone already chose refuses to start on
upgrade, with a message about a setting they never touched. A new retention setting defaulting to
90 days, which had to outlast a log retention someone had set to 180, would have stopped that
deployment.

**Enforced by:** Engineer — configuration tests asserting each derived default.

### SV-3 (SHOULD) In production, refuse to start on a credential the repository publishes.
The development compose file and `.env.example` hold working development credentials; the boot
check refuses each of them, any fake identity provider, and a credential shorter than its minimum,
when running as production.

**Why:** a default is how a committed development password reaches a server.

**Enforced by:** Engineer — a contract test enumerates the credentials the repository's files
publish, so a new one cannot be missed by the boot check.

### SV-4 (MUST) SIGTERM finishes the unit of work in progress and exits.
Check for stopping between units, never in the middle of one. The deployment's grace period is
longer than the longest unit (DE-3).

**Why:** a deploy or reboot should never leave a record half written.

**Enforced by:** Engineer — a test that sends the signal mid-unit.

## Working a queue

### SV-5 (MUST) Work that fails is left queued and retried with backoff; it is never marked done.
Keep failing items out of the way of newer work, and raise an alert when one keeps failing. A
refusal is not a failure to retry: a 4xx is a verdict on the request, except the ones the API
documents as transient (429 always; often 408, 423 and 425, and 409 in some APIs). Do not send a
verdict again — but it is not done either; park it for a person and raise an alert.

**Why:** a failure marked processed is a change the downstream system never receives; a failure
retried at the head of a queue every cycle starves everything behind it. One service's malformed
request cost five attempts and minutes of queue time each cycle before refusals were parked.

**Enforced by:** Engineer — tests of each path.

### SV-6 (SHOULD) A service replacing another starts in shadow mode.
It performs every read and records every write it would make, without making it, beside the system
it replaces, until the two have been compared. The mode defaults to shadow; live has to be asked
for by name. A shadow run is evidence only for what shadow exercises: it neither retries a failed
write nor raises the alerts writes would raise, so its silence proves nothing about retry, giving
up, alerting or any write path. Those are proven by rehearsal or in the first live days.

**Why:** one cut-over checklist ticked "no cycle fails repeatedly" because no alert had been raised
in shadow; review found shadow could not have raised one.

**Enforced by:** Engineer — the write facades (CD-6) record instead of writing in shadow mode.

**Prior art:** dark launching; GitHub's Scientist.

### SV-7 (MUST) One consumer per queue, unless every item is claimed under a lease (SV-8).
Never run two consumers of the same work at once without that claim: not the old and new versions
of a service, not copies on two hosts.

**Why:** two consumers that each believe an item is theirs both work it, and every write is made
twice — on a system that cannot deduplicate (SV-14), permanently.

**Enforced by:** Engineer for a deploy that stops the old container before starting the new;
Administer between hosts and during a cut-over. Missing Engineer control: a lock on the queue that
a consumer takes at startup, refusing to start while another holds it.

### SV-8 (MUST) Consumers that share a queue claim each item under a lease before working it.
A lease is exclusive and expires: acquired with a conditional write that succeeds only when the
item is unclaimed or its claim has expired, renewed while the item is worked, released in a
`finally`. Its store is one every consumer on every host reaches. Each grant carries a fencing
token that rises monotonically, recorded with every write made under it, so a write from a consumer
whose lease lapsed is detectable. Where an item needs several claims, every consumer takes them in
the same fixed order. Losing a lease mid-item stops work on it without committing.

**Why:** a lock without expiry is held forever by a consumer that died holding it; a lock without
fencing cannot tell a live owner from one that woke after its lease ran out; a host-local lock is
no lock once a second host joins. A legacy fleet's record lock had none of the three.

**Enforced by:** Engineer, where built: a test runs two consumers against one queue with a short
lease and asserts no item is worked twice. Administer until then. Missing Engineer control, until
built: that test.

**Prior art:** Martin Kleppmann, "How to do distributed locking" (2016).

## Answering requests

### SV-9 (MUST) An HTTP service's errors are a registry of codes, and the registry is tested.
Every error body has one shape — a code, a message, optional detail — and the codes and their
statuses live in one table, which a test compares exactly, so renaming a code is a failing test
rather than a silent break in every caller. A missing record, a malformed request and an unmatched
route are different codes, even when all three are 404.

**Why:** callers branch on codes (ER-8). A caller that treats any 404 as a deletion deletes real
data the day a path is built wrong.

**Enforced by:** Engineer — the registry test.

**Prior art:** RFC 9457 (Problem Details for HTTP APIs) solves the same problem with a different
body shape; either works if the codes are registered and tested.

### SV-10 (MUST) Health reports what was observed, and nothing records "reached" before the answer has been judged.
A `/health` endpoint reports each backend's reachability from what calls actually observed. A
backend that answers with a failure of its own is unavailable, not reached. A liveness check the
proxy polls touches no backend. When the service's own store is down, credentials cannot be
checked: answer 503, never 401, and never cache the outage as a refusal.

**Why:** recording "reached" first restarted the failure count on every call, so an outage never
aged on the health page. A 401 during an outage sends a caller to rotate a working credential.

**Enforced by:** Engineer — a test of a failure path makes two calls and asserts the count is two
and the outage start did not move; one call cannot tell the orders apart.

**Prior art:** liveness and readiness probes (Kubernetes).

## Alerting

### SV-11 (MUST) Something the operator must act on is an alert that is raised and cleared.
Raised when it starts, cleared when it resolves; the alerting system owns deduplication,
acknowledgement and notification. An alert belongs to the program, not one process: a restarted
process clears, on its next success, an alert an earlier one raised. Its subject names a record by
surrogate key, never by personal data (DP-3).

**Why:** an alert that is never cleared leaves the operator guessing whether the problem is over,
and one owned by a process stays raised after a restart, until the list of live alerts is mostly
stale and nobody reads it.

**Enforced by:** Engineer — the alerting client, with tests that a restart can clear.

**Prior art:** ISA-18.2 / IEC 62682 alarm management: an alarm has a defined state, owned by the
system, and returns to normal when its cause clears.

### SV-12 (MUST) One incident is one alert, however many items it affects.
Raise for the cause, not per record: a worker with hundreds of failing items raises one alert for
its queue, whose detail counts them and lists the first few by key. Update the detail when it
changes, not every cycle. Clear it only when the cause is gone, judged so that a restart, which may
forget what it counted, cannot clear a live incident: a cycle counts as complete for clearing only
if every row it read was run.

**Why:** an outage that fails every item would otherwise page someone hundreds of times, and teach
them to ignore alerts. One restarted process judged its queue from row counts alone and cleared an
alert while the stuck item's newest change sat filtered out.

**Enforced by:** Engineer for the completeness of a cycle (a test); Administer for the rest.
Missing Engineer control: a test against the alerting client's fake that one cause failing many
items raises one alert.

**Prior art:** ISA-18.2 / IEC 62682, alarm management in the process industries: every alarm
actionable, no floods. Google's SRE books on alert fatigue.

### SV-13 (MUST) Something outside the alerting system watches the alerting system.
An uptime monitor on other infrastructure polls its health endpoint and alerts through a separate
channel after consecutive failures.

**Why:** the watcher's own outage is the one thing it cannot report: the console goes quiet, and
quiet looks like nothing wrong.

**Enforced by:** Protect — the outside monitor.

## Calling other systems

### SV-14 (SHOULD) A write the other system cannot deduplicate is recorded as begun before it is sent, and one whose outcome is unknown is settled by reading that system, never by sending again.
Commit "sending" to your own store before the call. A timeout, a lost connection or a malformed
answer after sending is "unknown", not "failed": park the item, and after a settling interval look
for the write in the system of record itself. Found, record it done. Absent, it may be sent again a
bounded number of times, then left for a person. A replica cannot answer, because it lags. Only a
refusal raised before anything left the process is a plain retry; any other failure, an
unclassified throw included, may have landed — a client can throw after the remote answered, on a
response it cannot read.

**Why:** retry is right for idempotent work and wrong here. Against an API with no idempotency key
and no delete, a resent upload is a permanent duplicate. One design resent without a bound, and its
review found three plausible ways the search could miss a document that had landed.

**Enforced by:** Engineer — each state has a test that fails without it.

**Prior art:** idempotency keys (Stripe's API) are the fix when the other side offers them; the
transactional outbox pattern for the "begun" record.

### SV-15 (SHOULD) Read a change from a replicated feed only once it has settled.
Wait until a change is older than the replica's measured lag plus the source's stamp spread, and
leave younger rows for the next cycle; a cycle that leaves one has not read the whole queue
(SV-12).

**Why:** a read seconds after a change appears can see the change without the rest of it. One feed
stamped related changes up to five seconds apart on a replica fifteen seconds behind; a consumer
reading at once saw the previous state on about 3% of changes.

**Enforced by:** Engineer — the settle window, with a test. Higher: the feed itself withholds
changes younger than the window, so no consumer needs to know the numbers.

### SV-16 (MUST) Measure whether another system's update replaces the whole record.
Some update operations clear every member they are not sent; others keep or merge them, and the
same API can do each on different operations. Until measured, treat an update as a whole-record
replace: send the whole record you read, changed in place, never a fragment built from scratch.

**Why:** an update that omitted members cleared them in production.

**Enforced by:** Administer. A client that only offers read-modify-write makes it Engineer. Missing
Engineer control: that client, whose update takes only a record it returned from a read, so a
fragment does not compile.

### SV-17 (MUST) A 404 means "no such record" only when its code says so.
A missing version, a retired contract or a malformed path can also answer 404, and a 503 is "try
again later", never a verdict. A 200 with an empty list means nothing matched, not an error. This
is the caller's side of SV-9's registry, and an instance of ER-8.

**Why:** a caller that treats any 404 as "deleted" deletes real data when a version is retired.

**Enforced by:** Engineer — the client maps each code to a distinct `Result` error (ER-1), with a
test that a 404 carrying any other code is not read as "missing".

### SV-18 (MUST) Writes to a production system with no sandbox go only to records the owner designates, within a budget the owner states, and are put back.
Read each record first and restore it after; stop at the budget whether or not calls succeeded. The
budget covers the whole designation, shared across runs in one ledger, and admits a check only
while what is left covers it and its cleanup. Judge a create by the parent its body names, and
refuse every write type the owner has not named. Confirm which tenant the credentials reach by a
record kept beside them: an API's "who am I" names the user, and a test tenant cloned from
production carries production's users. This is the deliberate exception to TS-1.

**Why:** some systems have no test tenant for writes and bill every call; a write to a real
customer's record is a real change.

**Enforced by:** Engineer, where the client's write guard keeps the ledger; Administer otherwise.
Missing Engineer control, where the client has none: a write guard that keeps the ledger and
refuses a write outside the designation or past the budget.

### SV-19 (SHOULD) Every property name read from or written to another system is checked against its schema.
This complements BD-1 (which refuses a missing member only where the code parses it) and TS-11
(which holds fakes to what the service sends).

**Why:** some APIs do not refuse an unknown property in a read; they leave it out, so a wrong name
reads as empty forever. One importer read a field from the wrong object type; it had been empty in
production since before the rewrite.

**Enforced by:** Engineer — a test that reads the other system's schema (or a recorded copy) and
fails on a name the code uses that it lacks.

### SV-20 (MUST) Every outbound call has a deadline per attempt that covers the whole exchange, and the worst case of a unit of work fits inside the stop grace period.
What "deadline" means depends on what the call reaches:
- **HTTP and SDK calls:** a timeout signal per attempt, with the response body read inside the same
  signal and the same adapter `catch` (ER-3). `fetch` resolves when the headers arrive, so a
  deadline that ends there leaves the body unguarded.
- **Databases:** a client-side deadline on acquiring a connection from the pool, where nothing has
  reached the server yet; and a server-side bound on the statement itself (`statement_timeout` and
  `lock_timeout` in Postgres, or the engine's equivalent). A signal on the query alone does not
  count: aborting on the client can leave the statement running and holding its locks, and inside a
  transaction the caller no longer knows what happened. Migrations taken at boot under an advisory
  lock (DB-4) wait on purpose, so they have a bound of their own, not the request deadline, or a
  second instance booting during a long migration fails instead of waiting.
- **Subprocesses:** the child is killed when the deadline passes, and the caller checks the abort
  signal rather than the exit status, since an aborted child may report an ordinary exit (ER-10).

A client's built-in default deadline counts only if a test pins that default. The worst case of one
unit of work is the sum, over every outbound call on its path, of attempts × per-attempt deadline +
backoff, counting each client library's own retries and defaults; it stays below the deployment's
stop grace period (SV-4, DE-3).

**Why:** a call with no deadline holds its unit of work for as long as the other side chooses, and
a deploy's SIGTERM then kills it halfway. A client's defaults of 120 seconds a try and three tries
came to about six minutes against a four-minute grace, bringing back the kill the deadline was
meant to prevent. A loopback test caught a dropped timeout that fakes of the client's own interface
had passed (TS-9).

**Enforced by:** Engineer, partly: a contract test computes the worst case from the configured
retry settings and compares it with the deployment's grace period (TS-7). Missing Engineer control:
a lint rule refusing a call to `fetch` or a client method without a `signal` argument, outside
tests.

### SV-21 (SHOULD) Retry only what is transient and safe to repeat, a bounded number of times, with exponential backoff and jitter; use the other side's idempotency key wherever it offers one.
A retry is for a failure the other side calls transient (a network error before sending, 429, 503,
and the statuses its documentation names) on an operation that is safe to repeat: a read, or a
write carrying an idempotency key. Backoff grows exponentially and is randomized (full jitter), so
many clients that failed together do not retry together. The number of attempts is bounded, and the
bound counts toward SV-20's worst case. A write with no key and an unknown outcome is not retried
at all: it is settled by reading (SV-14). Only an error raised before anything left the process is
safe to retry for such a write; any other failure may have landed, including a client throwing
while parsing the reply. A 4xx other than those documented as transient is a verdict: never
retried, never marked done, parked for a person (SV-5). A 429 honours `Retry-After`.

**Why:** retries without jitter synchronize, and a recovering service is knocked over by its own
clients' second wave; retries of a non-repeatable write make duplicates. Bounded backoff for
failing work is field-tested (SV-5); jitter and idempotency keys are not yet proven in a project
under this standard, though both are long established elsewhere.

**Enforced by:** Engineer, where the retry policy lives in one adapter helper with tests for its
bound, its jitter and its refusal to retry a verdict. Missing Engineer control: a lint rule
refusing retry loops written outside that helper.

**Prior art:** Marc Brooker, "Timeouts, retries, and backoff with jitter" (Amazon Builders'
Library); Stripe's idempotency keys; Michael Nygard, *Release It!*

### SV-22 (MAY) Put a circuit breaker in an adapter whose callers would otherwise pile up on a failing dependency. (PROPOSED)
After a run of failures, the adapter fails fast for a cooling-off period without calling the
dependency, then lets a trial call through. It returns its own `Result` error for "breaker open",
so callers tell it from the dependency's failure, and it reports its state on the health endpoint
(SV-10). An open breaker records the dependency as unavailable; it never records an item as tried
and failed, or as done, or breaker state leaks into retry counts and parks healthy items.

**Why:** a synchronous service whose dependency is down spends every request waiting out a
deadline, and its own callers time out in turn. A queue worker rarely needs one: SV-5's backoff
already stops it hammering a failed dependency.

**Enforced by:** Engineer — the breaker and its tests (open, half-open, closed).

**Prior art:** Michael Nygard, *Release It!* (the circuit breaker pattern).

## Contracts that outlive a deploy

### SV-23 (SHOULD) A contract between services changes by expand and contract, never in one step. (PROPOSED)
Add a field as optional; deploy every consumer that reads it; only then make producers send it
always. Remove a field in the reverse order: stop reading, deploy, stop sending. A rename is an add
and a remove, in that order, never one change. The owner's client (RP-5) carries both shapes during
the change.

**Why:** in a rolling deploy, and after any rollback, an old and a new version run at once, and
each must understand the other. DB-4 applies the same discipline to tables, where it is
field-tested.

**Enforced by:** Administer. Missing Engineer control: a contract test in the owner's repository
that decodes recorded payloads of the previous release with the current client, and the current
client's output with the previous release's decoder.

**Prior art:** expand/contract ("parallel change").

### SV-24 (SHOULD) A payload that outlives the process that wrote it carries a version, and its reader accepts the current version and the one before. (PROPOSED)
Queue messages, stored JSON documents, cache entries and files written for a later run each carry a
schema version. The decoder (BD-1) accepts the current version and the previous one, mapping the
older into the current type, and refuses anything else by name. A new version is written only after
a release that can read it is everywhere, so a rollback never meets a payload it cannot read. A
change of meaning bumps the version as surely as a change of shape: a field whose shape stays the
same while what it holds changes is a new version, and the commit states what the previous release
does with payloads the new one writes (as DB-4 asks of a column).

**Why:** a queue holds work across a deploy. After a rollback, the previous image reads messages
the new one wrote; without a version it misreads them silently, and the kind of defect DB-4 records
for a column whose meaning changed reappears in the queue.

**Enforced by:** Engineer, where built: the decoder's tests include a recorded payload of each
accepted version. Missing Engineer control: a test that fails when the writer's version is higher
than any version the previous release's decoder accepts.

## Observability

### SV-25 (SHOULD) Correlation context travels implicitly, and the logger attaches it. (PROPOSED)
A request id or trace id, and the identity of the job or queue item being worked, are set once at
the entry point in an `AsyncLocalStorage` (available in Node, Deno and Bun), read by the one logger
the project uses, and forwarded by adapters as trace headers. No function signature carries them
for logging's sake. Code logs only through that logger. A correlation id is opaque and generated,
never derived from a record key or a person's identifier: the logger copies it into every line and
error, so whatever it is made of travels everywhere (DP-3).

**Why:** a `Result` error logged deep in a call chain is useless in a busy service unless it can be
tied to the request or item that caused it, and threading an id through every signature is noise
that an agent will get wrong somewhere.

**Enforced by:** Engineer — `no-console` outside the logger module, and a test per adapter proving
the context survives the adapter's callbacks and timers (context is lost across some callback-based
APIs).

**Prior art:** W3C Trace Context; OpenTelemetry context propagation.

### SV-26 (MUST) Implicit context never decides authorization. (PROPOSED)
Tenant, user and permission are explicit, branded parameters (BD-5) of every function that acts on
them. Ambient context may record who is acting, for logs, but no code reads it to decide what is
allowed.

**Why:** implicit context can be lost (a callback that drops it) or leak (a pooled resource that
keeps the last request's), and either fails silently. For a log line that costs a missing field;
for an authorization check it costs another tenant's data.

**Enforced by:** Engineer — `no-restricted-imports` allows the context module's getter only in the
logger and the entry points. That lint confinement is what makes the rule real; without it only
review would hold it. It is MUST while still proposed because the hazard is one that would hurt any
project.
