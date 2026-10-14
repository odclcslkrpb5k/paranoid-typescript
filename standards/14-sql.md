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
An error raiser is `stable`. Generated SQL is held to the same rule.

**Why:** Postgres does not enforce labels. An unlabelled read-only helper defaults to `volatile`,
is re-evaluated per row, and makes every `stable` caller call a volatile expression; 32 of one
schema's 41 findings were its unlabelled raiser, emitted by a generator no review looked at.
`immutable` is wrong for a raiser: called with constants, it is folded at plan time and raises
before the branch meant to guard it.

**Enforced by:** Engineer, partly (`plpgsql_check` sees a `stable` function calling a `volatile`
one). Missing: a catalog test that every `volatile` function is on an explicit list of writers.

### SQ-3 (SHOULD) Write `language sql` where the error contract allows, and `language plpgsql` where it must.

**Why:** a `language sql` body is resolved when it is created, so a rebuild re-validates it for
free. Know the ratio: a contract of raising typed errors forces plpgsql on most functions, which is
why SQ-1 is not optional.

**Enforced by:** Administer.

### SQ-4 (SHOULD) Prefer `returns table (...)` to `returns json`; a function that returns JSON has exact key-set tests.
At every level, for every array element, against a fixture made non-empty on purpose, with the
empty case asserted separately: `json_agg` over zero rows is `null`, not `[]`, unless `coalesce`
says so.

**Why:** the catalog pins a table return's names and types; a JSON document's keys are a contract
nothing checks. A `json_agg` without `coalesce` returned `null`, and a shape test over an empty
table had been passing vacuously.

**Enforced by:** Engineer for `returns table`; Administer for the key-set tests.

### SQ-5 (SHOULD) Validate caller input before casting it in SQL, and never cast a raw parameter to a date or time.

**Why:** `(p ->> 'typeId')::int` turned `{"typeId":"abc"}` into a 500 naming a cast.
`'now'::timestamptz` is valid, as are `yesterday` and `infinity`, each silently meaning something.

**Enforced by:** Engineer for the enumeration (BD-2's script lists casts in `.sql` files and SQL
string literals); Administer for the judgement.

### SQ-6 (SHOULD) Test every boolean function with a null argument, and every CHECK meant to forbid a state with the column null.

**Why:** a predicate returned `NULL` rather than `false` because its `coalesce` sat inside a scalar
subquery; `not NULL` is `NULL`, the guard branch was not taken, and an authorization check failed
open. A CHECK passes on `NULL`. No type system sees either.

**Enforced by:** Administer. Missing: a catalog test that every `returns boolean` function has a
null-argument case.

### SQ-7 (SHOULD) Repeatable functions live in their own schema and are rebuilt as one set.
`db/functions/NN-description.sql`, applied in one transaction that drops and recreates the schema
when the set's checksum changes. Nothing depends on that schema except triggers its files create:
no generated column, default, check, view or index expression references it. An empty set never
replaces a non-empty applied one.

**Why:** `create or replace` cannot change a signature or return type, so a set is replaced whole,
and the cascade silently drops whatever depends on it. A missing directory once read as an empty
set: the rebuild would have dropped every function and audit trigger, and the deploy reported
green.

**Enforced by:** Engineer — migrator tests (rebuild only on change, a trigger survives, an empty
set is refused) and a dependency test over `pg_depend`.

### SQ-8 (SHOULD) Keep the Postgres pin at the newest minor, and verify a move.
Read the release notes' migration actions against the catalog; where a note names a primitive that
authentication or integrity depends on, test it on both versions; rehearse against a populated
volume from the old minor.

**Why:** extensions are built against the newest minor and may not load on an older one. "Minor
upgrades are just a restart" is a statement about the data format only.

**Enforced by:** Administer.
