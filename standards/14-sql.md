# 14 SQL

How SQL that carries application logic — functions, triggers, casts — is written, checked and
tested. Postgres throughout. Chapter 13 covers the database as infrastructure.

### SQ-1 (SHOULD) Check every plpgsql function and trigger attachment with `plpgsql_check`, as a test.
The extension lives in a development and CI image only; production runs the stock image. The test
creates the extension in a transaction it rolls back, over the migrated schema. Row triggers are
checked against each attached table; statement triggers with transition tables get them
synthesized. Any suppression is keyed on function and message (never line), carries a reason, and
fails both ways: on an unregistered finding and on a registered one that matches nothing. The test
asserts floors on the functions and triggers checked, and the extension's minimum version.

**Why:** a plpgsql body resolves identifiers only when the line runs, so a stale column compiles
and waits for the first request that reaches it; a renamed variable sat behind a passing test for
months. An older build of the extension found 9 problems where a current one found 41. Zero
functions checked and zero findings are the same answer (TS-6).

**Enforced by:** Engineer — the test.

### SQ-2 (SHOULD) Label every function's volatility: `stable` for reads, `immutable` for pure computation, unlabelled only for writers.
An error raiser is `stable`. Generated SQL is held to the same rule. A `stable` or `immutable`
function reads under the snapshot of the statement that calls it, taken before any volatile call in
that statement writes: `return x_json(make_x(...))` looks up a row that, in its snapshot, does not
exist yet, and answers null. Assign the writer's result in a statement of its own first
(`v := make_x(...); return x_json(v);`), with a comment saying why, so nobody folds it back.

**Why:** Postgres does not enforce labels. An unlabelled read-only helper defaults to `volatile`,
is re-evaluated per row, and makes every `stable` caller call a volatile expression; 32 of one
schema's 41 findings were its unlabelled raiser, emitted by a generator no review looked at.
`immutable` is wrong for a raiser: called with constants, it is folded at plan time and raises
before the branch meant to guard it. In one schema, `return project_json(make_project(...))`
returned null and every create answered 500; `plpgsql_check` does not flag it.

**Enforced by:** Engineer, partly (`plpgsql_check` sees a `stable` function calling a `volatile`
one). Missing Engineer control: a catalog test that every `volatile` function is on an explicit
list of writers.

### SQ-3 (SHOULD) Write `language sql` where the error contract allows, and `language plpgsql` where it must.

**Why:** a `language sql` body is resolved when it is created, so a rebuild re-validates it for
free. Know the ratio: a contract of raising typed errors forces plpgsql on most functions, which is
why SQ-1 matters most where plpgsql dominates.

**Enforced by:** Administer. No practical Engineer control: whether the error contract allows
`language sql` needs reading what the function must raise.

### SQ-4 (SHOULD) Prefer `returns table (...)` to `returns json`; a function that returns JSON has exact key-set tests.
At every level, for every array element, against a fixture made non-empty on purpose, with the
empty case asserted separately: `json_agg` over zero rows is `null`, not `[]`, unless `coalesce`
says so.

**Why:** the catalog pins a table return's names and types; a JSON document's keys are a contract
nothing checks. A `json_agg` without `coalesce` returned `null`, and a shape test over an empty
table had been passing vacuously.

**Enforced by:** Engineer for `returns table`; Administer for the key-set tests. Missing Engineer
control: a catalog test that lists every function returning `json` or `jsonb` and fails on one with
no key-set test registered for it.

### SQ-5 (SHOULD) Validate caller input before casting it in SQL, and never cast a raw parameter to a date or time.
"Before" means a statement of its own, an `if` that returns or raises, or a `case`, never another
operand of the same boolean expression: SQL does not promise to evaluate `and` and `or` from left
to right, so `jsonb_typeof(p) <> 'number' or (p)::numeric < 0` may run the cast first and raise
22P02 instead of the coded refusal.

**Why:** `(p ->> 'typeId')::int` turned `{"typeId":"abc"}` into a 500 naming a cast.
`'now'::timestamptz` is valid, as are `yesterday` and `infinity`, each silently meaning something.

**Enforced by:** Engineer for the enumeration (BD-2's script lists casts in `.sql` files and SQL
string literals); Administer for the judgement. Missing Engineer control: a check refusing a cast
of a parameter to a date or time type in `.sql` files; whether other casts follow validation needs
a reader.

**Prior art:** the Postgres manual, "Expression Evaluation Rules", which says the order of
evaluation of subexpressions is not defined and recommends `case` where it matters.

### SQ-6 (SHOULD) Test every boolean function with a null argument, and every CHECK meant to forbid a state with the column null.
A CHECK on an array pins its shape as well as its contents: `cardinality` counts every element of
every dimension and `= any` searches them all, so a CHECK of "1 to 100 values, no nulls" accepts
`'{{1,2},{3,5}}'`, which `to_json` emits as `[[1,2],[3,5]]` and breaks a `number[]` contract. Add
`array_ndims(x) = 1`. For `numeric`, `'NaN' = 'NaN'` is true, so `'NaN'::numeric = any(x)` does
catch a NaN, and `to_json` writes NaN and Infinity as strings.

A predicate a caller may wrap in `not` is made two-valued, and in a form an index can still serve:
`col is not null and col = any($1)` on a nullable column, with `or col is null` added only where
the caller asks for rows with none. `coalesce(col = any($1), false)` is two-valued too, but the
planner cannot use an index through it. A test pins the list of nullable columns the generator
knows against the catalog, so a column made nullable later is not missed.

**Why:** a predicate returned `NULL` rather than `false` because its `coalesce` sat inside a scalar
subquery; `not NULL` is `NULL`, the guard branch was not taken, and an authorization check failed
open. A CHECK passes on `NULL`. No type system sees either. In a compiled filter,
`not (assignee_id in (...))` is null for a row with no assignee, so "not assigned to them" dropped
every unassigned row; a property test (TS-16) found it on its first run. On Postgres 18.6, over
20,000 rows a third of them null, that `not` kept 13,067 rows where `is distinct from` kept 19,733,
and `coalesce(... = any(...), false)` turned an index scan into a sequential scan, while
`col is not null and col = any(...)` kept the index.

**Enforced by:** Administer. Missing Engineer control: a catalog test that every `returns boolean`
function has a null-argument case.

### SQ-7 (SHOULD) Repeatable functions live in their own schema and are rebuilt as one set.
`db/functions/NN-description.sql`, applied in one transaction that drops and recreates the schema
when the set's checksum changes. Nothing depends on that schema except triggers its files create:
no generated column, default, check, view or index expression references it. An empty set never
replaces a non-empty applied one.

Where two images serve from one database at once, as in a rolling deploy, the set is never rebuilt
in place. (PROPOSED)
- Each release installs its set into schemas of its own, named by the set's checksum, and the
  install refuses, rolling back whole, a set that creates, alters or drops anything outside them.
- The application role may execute the current set, the one adopted before it, and any set a live
  session names (in its `application_name`), and no other.
- An old set is dropped only when it is not among the newest few, ordered by when each was last
  adopted (so a rollback that adopts an older set again keeps it), and nothing names or depends on
  it.
- Trigger functions, which tables depend on, live in a stable schema that only migrations change.

**Why:** `create or replace` cannot change a signature or return type, so a set is replaced whole,
and the cascade silently drops whatever depends on it. A missing directory once read as an empty
set: the rebuild would have dropped every function and audit trigger, and the deploy reported
green. Rebuilding in place also assumes one image at a time: a service whose previous image kept
serving through a rolling deploy returned errors for 20 to 60 seconds of every deploy while its
functions were replaced under it.

**Enforced by:** Engineer — migrator tests (rebuild only on change, a trigger survives, an empty
set is refused) and a dependency test over `pg_depend`. For sets in their own schemas, a test per
refusal of the install, and a test of the grants.

### SQ-8 (SHOULD) Keep the Postgres pin at the newest minor, and verify a move.
Read the release notes' migration actions against the catalog; where a note names a primitive that
authentication or integrity depends on, test it on both versions; rehearse against a populated
volume from the old minor.

**Why:** extensions are built against the newest minor and may not load on an older one. "Minor
upgrades are just a restart" is a statement about the data format only.

**Enforced by:** Administer. Missing Engineer control: a CI check that fails when the pinned minor
falls behind the newest published; reading the release notes needs a person.

### SQ-9 (MUST) A function the application role may call with more privilege than its own pins its `search_path`, ending in `pg_temp`. (PROPOSED)
In Postgres, a `security definer` function runs with its owner's privileges. Give each one
`set search_path = <its own schemas>, pg_temp`, and revoke `TEMP` on the database from `PUBLIC`, so
the application role cannot create temporary objects at all. The install of a function set (SQ-7)
refuses a definer whose `search_path` is unset or does not end in `pg_temp`, and a function meant
to run as its caller that is a definer.

**Why:** Postgres searches the session's temporary schema before every other schema for tables,
views and types unless the path names `pg_temp` explicitly. Any role that can create a temporary
table can then shadow a table a definer function names without a schema, and the function works on
the caller's object with the owner's privileges. Checked on Postgres 18.6: a definer function with
`set search_path = public`, called by a role holding the default `TEMP`, read the caller's
temporary table in place of its own; the same function with `public, pg_temp` read its own. The
risk grows with SQ-7's pattern, where the application role may only execute functions and every
write goes through a definer: there, one unpinned function lets the application role choose what
the owner's privileges act on. (PROPOSED: one service has shipped it, with the install's refusals
tested.)

**Enforced by:** Engineer — the install's refusal, with a test per case (unset path, a path not
ending in `pg_temp`, a definer where an invoker was meant), and a catalog test that asserts the
application role's exact privileges, `TEMP` among them.

**Prior art:** the Postgres manual, "Writing SECURITY DEFINER Functions Safely" (under
`CREATE FUNCTION`).

### SQ-10 (SHOULD) A loop that opens an exception block per row is bounded below 64 rows that write.
A plpgsql `begin ... exception` block is a subtransaction, and each one that writes or locks a row
takes a transaction id of its own. Past 64 of them in one top-level transaction, the backend's
cache of them overflows, and every other session's snapshot must consult `pg_subtrans` until that
transaction ends: a slowdown of the whole instance, caused by one function. Bound the rows such a
loop takes, and say why where the bound is set; or check before acting rather than catching, so the
loop needs no block.

**Why:** the bulk change of one service caught a refusal per row; review found the loop unbounded.
Checked on Postgres 18.6, where `pg_stat_get_backend_subxact` reports 64 blocks that each wrote one
row as not overflowed and 65 as overflowed. The service caps a bulk change at 50 rows, in the
function and in the request's schema.

**Enforced by:** Administer, with the bound written where the request is parsed (BD-1) and in the
function. Missing Engineer control: a test per bulk function that runs it at its bound and asserts
`subxact_overflowed` is false.

**Prior art:** GitLab's account of removing subtransactions from its Postgres workload (2021); the
cache size is `PGPROC_MAX_CACHED_SUBXIDS` in Postgres's source.

### SQ-11 (SHOULD) SQL a function builds at run time has a test that reads its plan and names the index each query shape is meant to use. (PROPOSED)
`plpgsql_check` (SQ-1) cannot see a statement built with `format()` and run by `execute`, so only a
plan shows that a generated query is served by its index. The test seeds, runs `analyze`, and, on
one reserved connection, sets the function set's `search_path` and runs `deallocate all` first,
since a prepared statement outlives a rollback. It `prepare`s the generated text and runs `explain
execute` with literal parameters (`execute` refuses a subquery as one). It turns off
`enable_seqscan`, `enable_bitmapscan` and `enable_sort`, because over a few hundred rows a sort
always costs less and the plan would say nothing about a large table, and it asserts the index's
name. It proves the index can serve the shape, not that the planner chooses it unforced at volume;
that stays with an EXPLAIN over a seed of production size.

**Why:** a filter compiler's correct fix for a null (SQ-6) made a list's predicate opaque to the
planner, and nothing failed: the list was still right, only slow at volume. A mutant restoring that
form was killed by the plan test. On Postgres 18.6, a statement prepared inside a transaction was
still listed in `pg_prepared_statements` after its rollback, and `explain execute s((select 7))`
failed with "cannot use subquery in EXECUTE parameter".

**Enforced by:** Engineer — the plan test, one case per query shape the generator can emit.

### SQ-12 (SHOULD) A locking read that picks a row by its order reads again once the lock is held. (PROPOSED)
`select ... order by version desc limit 1 for share` picks the newest row, then waits if another
transaction holds it. Under READ COMMITTED, when that transaction commits, the statement re-checks
only the row it waited on, which still qualifies, and returns it: a newer row the other transaction
inserted is invisible to the statement's snapshot. Take the lock, then read the newest again in a
statement of its own; if it changed, lock that row and read again, until the two agree. This locks
one row however many exist.

**Why:** an issue created while its layout was being published waited for the publish, then was
filed under the version the publish had just replaced. On Postgres 18.6, with a publish holding
version 1 `for update` and inserting version 2, the waiting locking read returned version 1 after
the publish committed; a plain read afterwards returned 2.

**Enforced by:** Engineer — a race test that opens a publish, starts the read so that it waits,
commits the publish and asserts the new version was taken; its mutant returns without the second
read (TS-5).

**Prior art:** the Postgres manual's caution that `for update` with `order by` and `limit` under
READ COMMITTED can return rows out of order, or fewer than the limit.
