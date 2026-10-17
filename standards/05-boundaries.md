# 05 Boundaries

TypeScript's types disappear at run time. A value that crosses in from outside — a request body, a
database row, an environment variable, a file, a queue message, an SDK's response — has no type
until something has checked it. Casting it is lying to the compiler about it.

### BD-1 (MUST) Read outside data as `unknown`, and parse it once, where it enters, into a declared type.
- **One parse, at the boundary.** Nothing unsound downstream. A value that does not fit is refused
  loudly: `Number("eight")` is `NaN`, and `NaN` fails differently at every use.
- **Into a declared type**, not field by field out of a `Record`. Where the source declares the
  type — a client's response type, the owning service's contract — parse into that type, so one
  definition serves every consumer, and use the owner's decoder where it ships one.
- **Parse only what you read.** A whole-record schema lets a change in a member nobody reads (a new
  enumeration value, a new timestamp format) stall every read. Cut the schema to the members the
  code uses. The exception is the read half of an update that replaces the whole record: decode the
  whole contract, or a member the cut schema skipped is written back empty. Stalling on a contract
  change is the safer failure there.
- **Ignore unknown extra members; refuse a missing member, a wrong type and an unknown enumeration
  value.** An added field should break nobody. A new enumeration value should arrive as a code
  change, because callers switch on it exhaustively. A schema whose members are all optional
  accepts any object, so it also requires the record itself: decode the envelope the answer comes
  in, and refuse one without the record, or with a record under a key other than the one asked for.
- **Keep decimals exact.** Money and other decimals are parsed from text, never through a float.
- **Refuse only what no valid record could hold.** A parser of what the owner's own system returns
  refuses only what its column types or constraints rule out. One that refused a blank value the
  database actually held would have made every snapshot fail. A shape the data *should* have
  belongs in a database constraint, not in a consumer's parser.

The boundaries: database rows; `JSON.parse` (through ER-4's wrapper, which takes a schema);
environment and configuration (SV-1); HTTP and SDK responses, parsed in the adapter; files, queue
messages and command-line arguments.

**Why:** a mistyped configuration constant once silently skipped every record a service was meant
to process; a cast had told the compiler it was fine. A decoder that skipped missing members was
handed an answer of the shape `{ "<Type>": record }` and decoded it as an empty record; its test
fixtures were the bare record, so the tests passed, and that empty record was the read half of a
full-replace write. Review caught it from the other service's README.

**Enforced by:** Engineer — LN-2 bans `as` and `any`, so the only way to get a typed value from
outside is through a schema.

**Prior art:** "Parse, don't validate" (Alexis King, 2019). HAZOP's guide words (no, more, less,
part of, other than, reverse) make a checklist for reviewing a parser: what does it do with each?

**Example:** [`src/adapters/builtins.ts`](../examples/src/adapters/builtins.ts).

### BD-2 (MUST) Every coercion a change adds is a finding until justified.
`as`, `as unknown as`, `any`, non-null `!`, `Number(`, `String(`, `Boolean(`, `parseInt`,
`parseFloat`, `!!`, unary `+`, `@ts-ignore`, a SQL `cast(` or `::` over caller input, `JSON.parse(`
whose result is not received as `unknown`, `Object.assign(` on a typed value (its type is `T & U`,
so a plain number passes as a branded key), and a user-defined type predicate (`x is T`) or
assertion function (`asserts x is T`), which the compiler takes on trust exactly as it takes a
cast, and which lint does not see. Each gets two questions. Is it justified: the source type, why
it is not already the target, what happens to a value that does not convert? And is it in the right
place: a coercion compensating for a type the code could have had is a defect — fix the type, the
reader or the query. Survivors carry one line of justification.

**Why:** on the first pass over one codebase, 21 of 54 coercions were removable, and four hid real
bugs. Five plain-number keys survived a branding conversion inside `Object.assign`.

**Enforced by:** Engineer for `as`, `as unknown as`, `any`, `!` and `@ts-ignore` (LN-2), and for
`!!` (LN-5). For what lint cannot judge (`Number(`, `String(`, `parseInt`, unary `+`, SQL casts,
`Object.assign`), Engineer for the enumeration — a script lists every hit on the lines a change
adds — and Administer for the judgement, in review (SH-3). To inventory a whole codebase rather
than one change, diff against git's empty tree (`git hash-object -t tree /dev/null` prints its id),
so every line counts as added. No practical Engineer control for the judgement: whether a coercion
is justified needs the meaning of the source type and the intent of the code.

**Example:** [`tools/coercions.ts`](../examples/tools/coercions.ts).

### BD-3 (MUST NOT) Use `as unknown as`. Make the honest type and delete the cast.

**Why:** it is always the compiler saying the two types share nothing. There is no legitimate one.

**Enforced by:** Engineer — LN-2.

### BD-4 (MUST) A 64-bit integer is never a `number`.
`int8`/`bigint` columns, and 64-bit ids from any API, are `bigint`, or a branded string where the
value is an identifier and arithmetic means nothing.

**Why:** `number` is exact only to 2^53. The common Node Postgres drivers (node-postgres,
postgres.js) hand `int8` back as a string precisely because of this, and a `Number()` around it
once rounded an id to a different record.

**Enforced by:** Engineer — the row schema (BD-1) types the column; DB-3 keeps key widths uniform.

### BD-5 (SHOULD) Identifiers are branded types, minted only by a parse function.

    type OrderId = string & { readonly __brand: "OrderId" };

- **Each brand has one parse function that validates**, returning a `Result` (ER-1), and it is the
  only way to mint one; its single `as` is the one cast the boundary allows (exempted by file,
  LN-2). Refused input is an expected failure, not a bug, so the parse function never throws. Its
  error names the member and the kind of refusal, never the value.
- **The owner of a system owns its brands.** A key from another system is that system's branded
  type, exported by the client every consumer uses, and no consumer declares its own. A consumer's
  copy either silently matches the owner's (a string-literal brand with the same literal is the
  same type) or refuses it (a different literal, or a `unique symbol` brand); in both cases two
  definitions drift, and in the second a key from the client cannot be passed where the consumer's
  type is expected. Brands from different owners can be combined freely, because each names its own
  literal.
- **The client brands its own requests and responses**, so a key read from the remote system
  arrives branded and a key sent must be one. Make a key argument non-nullable where the remote
  system requires a key: a nullable one lets `fetch(parseOrderId(x))` compile and send a request
  for "no key", which one vendor's API read as key 0 — and billed.
- **Check the JSON type before minting.** A numeric key must be a JSON number when it reaches the
  parse function: a parse function that also accepts text would read the string `"7"` as key 7,
  hiding a sender that changed its format.
- **Choose, then mint.** When choosing among candidates (the latest, the largest), choose among the
  raw values and mint the one chosen: filtering non-keys first silently promotes the next one.
- **Report a present value that parses to null**, by member name. Otherwise a key that used to fail
  loudly becomes a quiet "none" that every later step skips.
- **One parameter per kind of key.** `key: CustomerId | OrderId` beside an argument saying which
  defeats the brand; split the function.
- A member whose kind depends on context stays unbranded until its owner classifies it.

**Why:** ids that are all `number` or all `string` can be passed for one another and still compile.
An order key passed where a customer key belongs compiled in every repository that handled both,
and on a write that is a real change to the wrong record. Where every query carries a tenant id,
mixing ids up is a permission defect.

**Enforced by:** Engineer — the compiler refuses one brand where another belongs; a type-level test
proves it does. Administer that a consumer uses the owner's brand rather than its own. Missing
Engineer control: `no-restricted-syntax` refusing a type with a `__brand` member outside the
project's own brand module, so another system's brand can only be imported.

**Prior art:** newtypes (Haskell, Rust); value objects and "primitive obsession" (Domain-Driven
Design); "make illegal states unrepresentable" (Yaron Minsky); branded types are the common
TypeScript idiom for them.

**Example:** [`src/ids.ts`](../examples/src/ids.ts),
[`test/fixtures/types/`](../examples/test/fixtures/types/).

### BD-6 (MUST) Know the time zone of every timestamp that comes from outside.
A zone-less wall-clock timestamp from another system is kept as text in a branded type, parsed only
with that system's declared zone, never the host's, and never pushed through `Date` or
`toISOString()` on the assumption it is UTC. Instants this program records about itself are real
UTC. Where a source is not uniform — two writers, one in local time and one in UTC — measure before
assuming either.

**Why:** converting a wall-clock value shifts it by the host's offset; a birth date gains a time of
day and, across a zone, moves to another day. One shared database turned out to hold the same
column in two zones depending on which process last wrote the row.

**Enforced by:** Administer: a string brand does not keep text out of `Date`, since `new
Date(branded)` still compiles. Missing Engineer control: `no-restricted-syntax` refusing `new
Date(...)` with an argument and `Date.parse` outside one time module, which takes the zone
explicitly.

### BD-7 (SHOULD) Take the "is this a JSON object" test from one shared helper.
`isRecord(value): value is Record<string, unknown>`, refusing arrays and `null`, defined once and
imported, not reimplemented per file.

**Why:** each private copy is another chance to forget `null` or arrays.

**Enforced by:** Administer. A schema library (see the open questions) makes it mostly unnecessary.
Missing Engineer control: `no-restricted-syntax` refusing `typeof x === "object"` outside the
helper's module.

**Example:** [`src/records.ts`](../examples/src/records.ts).

## Open questions

- **Schema library:** zod or valibot (or the owner's generated decoders). Choose on how well the
  types it infers read in error messages, since an agent reads those messages; and on whether it
  can return problems as values without throwing (ER-1). The examples use valibot: `safeParse`
  returns problems as values, and its `brand` action mints branded types without the cast a
  hand-written constructor needs (BD-5). Its issue messages quote the refused value, so they are
  reduced to member paths before they go anywhere (DP-3).
