# 13 Databases

For a service that owns a database. Examples are Postgres; the principles carry. A service that
reads someone else's database goes through that service's API instead, where one exists.

### DB-1 (MUST) Declare the collation when the database is created, in every environment.
For Postgres 17 and later: `--locale-provider=builtin --builtin-locale=C.UTF-8 --encoding=UTF8` in
the init arguments, in development and production alike.

**Why:** otherwise the image's C library decides how text sorts and compares — byte order under
musl, linguistic under glibc — and a change of that library under existing indexes silently
corrupts their order. Postgres warns only after the fact, and only where the library reports a
collation version (glibc does; musl does not). Once there are rows, changing it is a data
migration.

**Enforced by:** Engineer — a contract test reads every compose file.

### DB-2 (SHOULD) A database image the repository builds has a name of its own.
`image: <service>-db:<version>-dev` beside the `build:`, never an upstream name such as
`postgres:18`.

**Why:** a build under an upstream name retags that image in the local Docker, and every other
project on the machine that asks for it gets this build.

**Enforced by:** Administer. Missing Engineer control: a contract test refusing an upstream tag on
a built service.

### DB-3 (SHOULD) Every surrogate key has one width, and a catalog test says so.
One width for every key in the schema, so a key's type in the code does not depend on which table
issued it: the common Node drivers hand back `int8` as a string and `int4` as a number. Choose
`integer` for every key unless some table will exhaust it; if one will, every key is `bigint`, ids
are opaque branded strings in the code (BD-4), and nothing else in the schema is `bigint`. A single
sequence shared by every table is also worth having: an id then never names two rows in different
tables, so one passed to the wrong table finds nothing rather than the wrong row. The test
enumerates every table from the catalog, partitioned ones included, and asserts each key's width
and default.
The same test refuses a column of the key's type, or named as a reference (`*_id`), that is neither
its table's own key nor a column of a foreign key: such a column passes the width check and is
invisible to every check that reads the catalog's constraints, a tenancy check among them.

**Why:** a `Number()` that hid an `int8`/`int4` split for months is where the coercion rules (BD-2)
came from. In another schema, a `*_id` column with no foreign key passed the width check and
escaped every tenancy check that read `pg_constraint`: a reference across tenants waiting to
happen.

**Enforced by:** Engineer — the catalog test.

### DB-4 (MUST) Migrations are numbered, checksummed and never edited once applied; they run at boot under an advisory lock, and they are additive.
Additive, so the previous image runs against the new schema and a release can roll back (DE-4). One
that drops or renames says so in its commit, and its release is preceded by a backup. Additive is
not enough when a release changes what an existing column holds: its commit says what the previous
image would do with the rows the new one wrote.

**Why:** an edited migration makes two databases that claim the same version differ; a destructive
one turns a failed release's rollback into an outage. A changed meaning fails without an error: one
migration only added columns, but changed what an existing column held, and the previous image
would have rendered the new rows wrongly and logged nothing.

**Enforced by:** Engineer for the checksum and order: the migrator refuses a changed or misplaced
file. Administer for additivity. Missing Engineer control: a check that refuses a migration holding
`drop`, `rename` or a column type change unless its file carries an explicit marker naming the
backup.

**Prior art:** expand/contract ("parallel change") migrations.

### DB-5 (MUST) Migrations are plain SQL files, one per migration, never SQL held in TypeScript.
`db/migrations/NNN-description.sql`, applied in name order, each in its own transaction with its
record, recorded by file name and checksum. The migrator refuses a misnamed file, two files sharing
a number, and an applied file now missing at or below the image's highest number. An applied file
numbered above the image's highest belongs to a newer release and is left alone: that is the
previous image starting after a rollback, which must succeed.

One exception, for an index built without blocking writes. (PROPOSED) A file whose only statement
is `create index concurrently` runs outside a transaction, since Postgres refuses that statement
inside one; a file holding it beside any other statement is refused. The migrator takes over what
the transaction gave:
- **A failed build leaves an index behind.** A cancelled `create index concurrently` leaves an
  INVALID index, and a retry with `if not exists` skips it as present. Before building, drop
  (`drop index concurrently`) an invalid index of that name that no session is still building.
- **Ask who is building with `not exists`.** `pg_stat_progress_create_index` shows another role's
  build with a null `index_relid`, so `indexrelid not in (select index_relid ...)` matches no index
  at all, and `not exists` is needed.
- **Bound it by `statement_timeout`, not `lock_timeout`.** The build waits for every older
  transaction to end, and a `lock_timeout` cancels that wait and leaves the invalid index. Set
  `lock_timeout` to 0 under a `statement_timeout` for the build, and set both again before each
  later step, since they outlive the statement on that connection.
- **Record only a valid index.** Write the file's record after the build, and only once
  `pg_index.indisvalid` is true for it; a crash between the two reruns the file, which then finds
  the valid index and records it.

**Why:** a migration is read by people and tools other than the service — `psql` during an
incident, a reviewer reading the diff as SQL — and in a TypeScript string it serves none of them. A
plain `create index` holds a lock that blocks every write to the table until the build ends, which
on a large table is an outage, so the exception exists. Each of its traps was reproduced on
Postgres 18.6: a build under `lock_timeout` cancelled while an older transaction ran left an
INVALID index that `if not exists` then skipped, and, run as another role while a build was in
progress, the `not in` form matched none of 164 indexes where `not exists` matched all of them.

**Enforced by:** Engineer — the migrator, with a test per refusal. Testing the transaction: a
failing multi-statement migration leaves nothing behind even without one (Postgres runs a
multi-statement simple query as one implicit transaction), so test what the explicit transaction
adds — that a file and its record commit together — with a migration that makes its own record
unwritable. For the exception, a test cancels a build and asserts the next run drops the invalid
index, builds it and records it, and one asserts a file with any other statement beside the build
is refused.

### DB-6 (SHOULD) A cursor clients resume from is issued in commit order.
A sequence hands out values before the transaction commits, so two writers can commit in the
opposite order to their ids, and a reader resuming from `id > cursor` never sees the one that
committed late. Serialize the writes that take such ids, and state the assumption where they are
written.

**Why:** the reader cannot tell a missed row from a row that does not exist.

**Enforced by:** Administer. Missing Engineer control: a test that commits two writers out of id
order and asserts a resuming reader sees both.

### DB-7 (SHOULD) A page cursor carries the values its list is ordered by, not only the last row's id. (PROPOSED)
A cursor for a list ordered by a column that can change holds that column's value with the id,
and the next page is the rows after that pair: `where (updated_at, id) < ($at, $id)`, with an index
on `(updated_at, id)` in the same order. Read one row more than the page, so `next` is absent
exactly when nothing follows. Encode a timestamp as whole microseconds since the epoch:
`extract(epoch from ts)` is `numeric`, and `timestamptz 'epoch' + n * interval '1 microsecond'`
gives the same value back only while `n` is below 2^53, about the year 2255, since the
multiplication goes through `double precision`. A test changes the cursor's row between pages, in
each order the list offers.

**Why:** a cursor of only the last row's id, whose sort value was read again on the next request,
drifted as soon as that row changed. Newest first, editing the last row shown made the next page
repeat everything before it; oldest first, it ended the list early; a deleted cursor row ended it
silently. A review found it; no example-based test had. Reading exactly a page also offered an
empty page after every full last one.

**Enforced by:** Engineer — the test that edits the cursor's row between pages, mutation-tested by
widening `<` to `<=` and reading one row fewer (TS-5).

**Prior art:** key-set pagination ("seek method"), and Postgres's row-value comparison, which an
index on the same columns serves: on Postgres 18.6, `(updated_at, id) < (...)` ordered by both
descending ran as an index-only scan.
