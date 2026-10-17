# 04 Errors

Exceptions are invisible in a function's type. A caller cannot see what a function throws, the
compiler cannot check that it was handled, and a `catch` receives `unknown`. This chapter makes
expected failures part of the type, and confines exceptions to the two places they belong: foreign
code, and bugs.

### ER-1 (MUST) Expected failures are values: `Result<T, E>`.
A function that can fail in a way its caller must handle returns a `Result`:

    type Result<T, E> =
      | { readonly ok: true; readonly value: T }
      | { readonly ok: false; readonly error: E };

`E` is a discriminated union built only from the program's own words — a kind, a status, a
registered code, a member path — never a message or a value from outside. A failure can then be
logged and recorded whole without leaking data (DP-3). Callers switch on `E` exhaustively (LN-3),
so a new kind of failure is a compile error at every handler. Convert a codebase whole, not module
by module: a seam where a `Result` is turned back into a `throw` loses its description.

**Why:** this is the largest practical gain of the whole standard. Error records that kept only an
exception's class name made a revoked credential, an outage, a schema change and a timeout look
identical; typed failures recorded which. The first conversion found a timeout reported as bad JSON
and 19 tests that passed on any error.

**Enforced by:** Engineer — the compiler forces narrowing on `ok`; LN-3 forces exhaustive handling;
LN-6 forces use; ER-2 to ER-4's lint rules confine `throw` and `catch`.

**Prior art:** Rust's `Result`; railway-oriented programming (Scott Wlaschin); neverthrow and
Effect in TypeScript. Whether to use a library or a type of about thirty lines is open; projects so
far have used their own, with a lint plugin.

**Example:** [`src/result.ts`](../examples/src/result.ts).

### ER-2 (MUST) `panic()` is the only `throw`, for what the types rule out.
A broken invariant — a bug in this program, never a failure of something it depends on — calls
`panic(message)`, which throws a `Panic`. The `default` of an exhaustive switch calls
`unreachable(x: never)`, which panics. Nothing else throws, and `Promise.reject(...)` is a throw in
every spelling (`Promise["reject"]`, `Promise?.reject`).

**Why:** a `throw` that is not a bug is an expected failure hiding from the type system (ER-1).

**Enforced by:** Engineer — `no-restricted-syntax` on `ThrowStatement` and on `Promise.reject`
calls, with the panic module and the adapters (ER-3) exempt by file.

**Prior art:** Rust's `panic!` and `unreachable!`.

### ER-3 (MUST) Foreign code is met only in adapters.
Every external package, every `node:` module and every SDK is imported only under `src/adapters/`.
The exceptions are listed by name in the lint configuration: libraries that never throw on their
documented path (the schema library's non-throwing parse, the project's `Result` module), and the
test runner and assertion library, in tests only. An adapter calls the foreign code, catches what
it throws, and returns a `Result`.
- **Classify by the foreign code's own marks** — its error class, a driver's error code, an errno —
  and call anything else unexpected, never the system's failure: a bug in your own row reader must
  not read as a database outage. An errno the runtime has no class for (`ENOSPC`, `EIO`) arrives as
  a plain `Error` whose `code` is the errno; a check limited to `instanceof` calls a full disk
  "unexpected". A class alone can mislead: `fetch` throws `TypeError` both for a network failure
  (with a `cause`) and for a request it refuses to send (credentials in the URL, a bad header — no
  `cause`), and only the first is an outage.
- **An adapter may throw where a framework needs it.** A database driver that rolls a transaction
  back only when its callback throws; a scheduler that records a cycle as failed only when its
  callback throws. There the adapter turns an error `Result` into a throw to get the behaviour, and
  hands the `Result` back. Write it once, test it once. Without it, every failed cycle is recorded
  as clean.
- **`fetch()` resolving means only that the headers arrived.** Read the body inside the same catch
  as the request, with the same timeout signal, or a connection dropped mid-body escapes the
  adapter as a bare `TypeError`. A vendored client may wrap what `fetch` throws but not its body
  reads; check.

**Why:** libraries throw from wherever they are called, so they are called from one place. That
place is also the only one that knows the library's error marks, so it is the only place a failure
can be classified honestly.

**Enforced by:** Engineer — `no-restricted-imports` allows foreign modules only under
`src/adapters/`; `no-restricted-syntax` allows `catch`, `.catch(...)` and a `.then(...)` rejection
handler only there and in ER-5's catch-alls. Test fakes that stand for foreign code live in
`test/fakes/` and may throw and reject as the real thing does; they do not `panic()`, which claims
a broken invariant.

**Prior art:** ports and adapters (hexagonal architecture, Alistair Cockburn); the anti-corruption
layer of Domain-Driven Design (Eric Evans).

**Example:** [`src/adapters/http.ts`](../examples/src/adapters/http.ts).

### ER-4 (MUST) Built-ins that throw are called through wrappers that return a `Result`.
`JSON.parse`, `new URL`, `BigInt(...)`, `decodeURIComponent`, `atob`, `structuredClone`,
`Response.prototype.json` and their kind live in one small module of wrappers, each returning a
`Result` (and, for parsing, taking a schema: BD-1). Prefer a built-in's own non-throwing form where
the runtime has one: `URL.parse` answers `null`, so its wrapper needs no `try`;
`import.meta.dirname` gives a module's directory without building a `URL`; and a lenient
`TextDecoder` whose output re-encodes to the same bytes tells valid UTF-8 without the throw of
`fatal: true`, provided it is built with `ignoreBOM: true`, since otherwise a leading byte-order
mark is stripped and never round-trips. An option that sounds forgiving may not cover every input:
`Temporal.PlainDate.from` with `overflow: "constrain"` clamps a day of 40 but throws a
`RangeError` on a month or day of 0, so the wrapper refuses those first.

**Why:** `JSON.parse` throwing on a malformed body looks, at the call site, exactly like a line
that cannot fail. A wrapper puts the failure in the type, where the caller must handle it.

**Enforced by:** Engineer — `no-restricted-globals` and `no-restricted-properties` outside the
wrapper module. The list is never complete; review adds to it when a new throwing built-in shows
up.

**Example:** [`src/adapters/builtins.ts`](../examples/src/adapters/builtins.ts).

### ER-5 (MUST) Every entry point keeps a counted catch-all.
"Returns a `Result`" does not mean "never throws": a bug, a `Panic`, or a throw from a library the
adapter did not anticipate still arrives. Every caller of a port — a request handler, a queue loop,
a scheduled job — catches what it does not expect in one function whose name says so, so lint can
find it (for example a `Net` suffix, for "safety net": `handleRequestNet`). It records the throw by
class name, and a `Panic`'s message (the program's own words, and the only diagnosis of the
invariant); counts it toward the run's failure limit, raising or feeding an alert (SV-11); and
never treats it as success.

**Why:** the first draft of one conversion deleted every catch-all, reading "returns a `Result`" as
"never throws". Review found a bug would then leave no record and could never raise the alert.

**Enforced by:** Engineer — the lint rule in ER-3 permits `catch` only in adapters and in functions
with the catch-all suffix. Administer that each entry point has one. Missing Engineer control: a
test that lists the entry points (routes, queue loops, scheduled jobs) and fails on one whose call
into a port is not inside a catch-all.

### ER-6 (MUST NOT) Turn a failure into success.
No `catch` that neither records nor returns the failure; no unawaited promise (LN-4); no path that
marks work done after it failed. Where a failure is tolerated on purpose — a best-effort cleanup —
record it and say so in the code.

**Why:** of every defect class seen across the projects behind this standard, this one recurs most.

**Enforced by:** Engineer for the promise half (LN-4) and the `catch` placement (ER-3); Administer
for the rest, in review. Missing Engineer control: a lint rule refusing a `catch` block or
rejection handler that neither returns a failure nor records one through the project's logger. No
practical Engineer control for a path that marks failed work done: judging it needs to know what
done means for that work.

### ER-7 (MUST NOT) Answer an impossible case with a default.
A regex group the pattern requires is checked, and a missing one is a `panic()` or the function's
own "unparseable" result, never `?? 0`.

**Why:** a default turns the impossible into a wrong value that passes, and is often dead code that
a reader still trusts.

**Enforced by:** Administer, in review. `noUncheckedIndexedAccess` (CP-1) forces the check; nothing
forces its answer to be honest. Missing Engineer control: `no-restricted-syntax` refusing `??` or
`||` with a literal right-hand side on an indexed read or a regex group, each exception justified
in place.

### ER-8 (MUST) Branch on error codes, never on message text.
Where another system offers only text, match it exactly, write down the dependency, and ask its
owner for a code. Checking the message as well as the code, to stay safe against an older version
of the other side, is allowed and recorded.

**Why:** messages get reworded; codes are a contract.

**Enforced by:** Administer. SV-9 is the server side: a registry of codes, tested. Missing Engineer
control: `no-restricted-syntax` refusing a comparison, `includes`, `startsWith` or regex test on an
error's `message` property, with the recorded exceptions exempt by file.

### ER-9 (MUST) A process-level handler treats anything that reaches it as a bug.
`uncaughtException` and `unhandledRejection` handlers report the error (by class, and a `Panic`'s
message) and exit non-zero. They never resume.

**Why:** a process that carries on after an unknown failure is in an unknown state.

**Enforced by:** Engineer — the handlers, installed once at startup, with a test that one fires.

### ER-10 (MUST) Converting to `Result`s audits every abort.
Where a `throw` used to end a run, a returned failure does not: check every `throwIfAborted`, and
every caller of a function that threw on abort, so a run cut short is never carried into the next
stage or marked done. A subprocess API may report an abort as an ordinary exit rather than an
error: Node's `child_process` reports `signal: "SIGTERM"` with a null code, and shells and Deno
report exit code 143. Check the abort signal itself, or a timeout reads as a failed command.

**Why:** every step of the conversion changed production behaviour somewhere; aborts were where it
was least visible.

**Enforced by:** Administer, in the conversion's review; a test per abort path. Missing Engineer
control: a test that fires the abort signal at each stage of a run in turn and asserts the run is
never carried into the next stage or marked done.

**Prior art:** STPA's unsafe control actions (Nancy Leveson): an action stopped too soon, or
carried on after it should have stopped.
