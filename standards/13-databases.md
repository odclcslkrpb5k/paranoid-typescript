# 13 Databases

For a service that owns a database. Examples are Postgres; the principles carry. A service that
reads someone else's database goes through that service's API instead, where one exists.

### DB-1 (MUST) Declare the collation when the database is created, in every environment.
For Postgres 17 and later: `--locale-provider=builtin --builtin-locale=C.UTF-8 --encoding=UTF8` in
the init arguments, in development and production alike.

**Why:** otherwise the image's C library decides how text sorts and compares — byte order under
musl, linguistic under glibc — and Postgres cannot warn when that library changes under its
indexes. Once there are rows, changing it is a data migration.

**Enforced by:** Engineer — a contract test reads every compose file.

### DB-2 (SHOULD) A database image the repository builds has a name of its own.
`image: <service>-db:<version>-dev` beside the `build:`, never an upstream name such as
`postgres:18`.

**Why:** a build under an upstream name retags that image in the local Docker, and every other
project on the machine that asks for it gets this build.

**Enforced by:** Administer. Missing Engineer control: a contract test refusing an upstream tag on
a built service.

### DB-3 (SHOULD) Every surrogate key has one width, and a catalog test says so.
One width for every key, so a key's type in the code does not depend on which table issued it: the
Postgres driver hands back `int8` as a string and `int4` as a number. `integer` unless a table will
exhaust it; then `bigint`, ids are opaque branded strings in the code (BD-4), and nothing else is
`bigint`. A single sequence for the schema means an id never names two rows in different tables.
The test enumerates every table from the catalog, partitioned ones included, and asserts each key's
width and default.

**Why:** a `Number()` that hid an `int8`/`int4` split for two milestones is where the coercion
rules (BD-2) came from.

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

**Enforced by:** Engineer — the migrator refuses a changed checksum.

**Prior art:** expand/contract ("parallel change") migrations.

### DB-5 (MUST) Migrations are plain SQL files, one per migration, never SQL held in TypeScript.
`db/migrations/NNN-description.sql`, applied in name order, each in its own transaction with its
record, recorded by file name and checksum. The migrator refuses a misnamed file, two files sharing
a number, and an applied file now missing at or below the image's highest number. An applied file
numbered above the image's highest belongs to a newer release and is left alone: that is the
previous image starting after a rollback, which must succeed.

**Why:** a migration is read by people and tools other than the service — `psql` during an
incident, a reviewer reading the diff as SQL — and in a TypeScript string it serves none of them.

**Enforced by:** Engineer — the migrator, with a test per refusal. Testing the transaction: a
failing multi-statement migration leaves nothing behind even without one (Postgres runs a
multi-statement simple query as one implicit transaction), so test what the explicit transaction
adds — that a file and its record commit together — with a migration that makes its own record
unwritable.

### DB-6 (SHOULD) A cursor clients resume from is issued in commit order.
A sequence hands out values before the transaction commits, so two writers can commit in the
opposite order to their ids, and a reader resuming from `id > cursor` never sees the one that
committed late. Serialize the writes that take such ids, and state the assumption where they are
written.

**Why:** the reader cannot tell a missed row from a row that does not exist.

**Enforced by:** Administer.
