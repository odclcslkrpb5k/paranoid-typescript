# 02 Compiler

The compiler is the cheapest reviewer there is. This chapter turns it all the way up.

### CP-1 (MUST) Compile with `strict` and every check `strict` leaves out.

| Option | What it refuses |
|---|---|
| `strict` | the baseline: implicit `any`, unchecked `null`, unsound `this`, and the rest |
| `noUncheckedIndexedAccess` | `rows[0]` or a regex group read as certain; they are `T \| undefined` |
| `exactOptionalPropertyTypes` | `{ x?: string }` accepting an explicit `x: undefined` |
| `noImplicitReturns` | a code path that returns nothing |
| `noFallthroughCasesInSwitch` | a `case` that falls into the next |
| `noUnusedLocals`, `noUnusedParameters` | dead code that hides intent |
| `noImplicitOverride` | an override nobody marked `override` |
| `allowUnreachableCode: false`, `allowUnusedLabels: false` | dead code |
| `erasableSyntaxOnly` | enums, namespaces, parameter properties (TC-2) |
| `verbatimModuleSyntax` | a type-only import not written `import type` |
| `noUncheckedSideEffectImports` | a side-effect import (`import "./x"`) of a file that does not exist |
| `noPropertyAccessFromIndexSignature` | `row.field` on a `Record<string, unknown>`; write `row["field"]` |

**Why:** each turns a class of silent runtime `undefined` or dead path into a compile error.
Measured on seven services that already ran under `strict` with tidy boundaries, the rows from
`noUncheckedIndexedAccess` to `allowUnusedLabels` cost between none and six errors each;
`erasableSyntaxOnly` cost up to 27, one per parameter property;
`noPropertyAccessFromIndexSignature` cost 55 to 268 edits each. On an agent-written codebase of
59,000 lines that had only `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
`noPropertyAccessFromIndexSignature` together produced 2,349 errors, three quarters of them in
tests — which is why CP-2 exists. `noPropertyAccessFromIndexSignature` mostly turns `x.foo` into
`x["foo"]` on values that are honestly untyped. It pays once boundaries are parsed into declared
types (BD-1), so on an existing codebase it comes after that step (AD-4). Its cost can also come
from one annotation that widens a literal to an index signature. A styles object annotated
`: Record<string, CSSObject>` makes every `classes.root` an index-signature read. On a 380,000-line
frontend that accounted for about 85% of the flag's 5,966 errors. `satisfies Record<string,
CSSObject>` checks the same thing and keeps the literal keys: one convention change, not 5,000
`classes["root"]` edits that make the code worse. Group a flag's errors by origin before planning
them (AD-6).

**Enforced by:** Engineer — `tsc --noEmit` in the check command (TC-5).

**Prior art:** TypeScript's own `--strict` family. The list overlaps heavily with the community
`@tsconfig/strictest` base configuration, plus the erasable-syntax settings.

**Example:** [`tsconfig.json`](../examples/tsconfig.json).

### CP-2 (MUST) Check everything: source, tests, scripts and tools, under the same settings.
One `tsc --noEmit` run covers every TypeScript file in the repository, with no `exclude` for tests
or tooling. One exception is a directory of fixtures that exist to fail a check (CP-3, LN-9): it is
excluded from the main run and checked by the fixture test instead.

The other exception is code a generator writes, which no one edits. First choose or configure a
generator whose output passes the checks; exclude by path only what still cannot, from the compiler
and lint alike, recorded as a deviation (RP-6), and only on three conditions:
1. a check fails when the committed output differs from what the generator produces from the
   current inputs (TS-7);
2. the generator is configured as strictly as it allows: for GraphQL codegen, `strictScalars` with
   a `scalars` map, so a custom scalar has a declared type, and `avoidOptionals`, so a nullable
   field is present as `Maybe<T>` rather than optional (`@graphql-codegen/typescript` 6.1);
3. the generated types are treated as the owner's claims, not as a parse: data typed by them is
   still parsed at the boundary (BD-1), and the claims are checked against recorded responses
   (TS-11).

Where tests need something only tests may do, it goes through a named helper (`must(x, "what")`
asserts presence and narrows, where `x!` only silences the compiler), not a looser config.

**Why:** tests are code an agent writes too, and most of what a stricter setting finds is in them.
Looser rules for tests would leave most of the code under the weaker control. Generated code is the
opposite case: four generated files of one frontend held 645 `as`, 311 `as unknown as` and 297
`any`, which no one can fix in place, and which a baseline would hold forever. The control that
matters there is freshness, which that project's CI already enforced.

**Enforced by:** Engineer — the single project configuration; for generated code, the freshness
check and the generator's configuration.

### CP-3 (SHOULD) Prove that every compiler option is honoured.
Keep one fixture per option in `tsconfig.json`: a file that must fail the check with that option on
and pass with it off. A test runs each fixture both ways, and fails when an option has no fixture.

Source vendored from another project (RP-4) is checked under the consumer's options, not its own,
so its guarantees hold only if those options match. The consumer runs the library's fixtures in its
own suite, and a test fails when its root configuration lacks one of the library's options or sets
it differently, with a planted mismatch proving the test can fail (TS-7).

**Why:** the settings file can claim a protection the checker does not give. An `extends` chain can
override a flag, a later edit can drop one, and a runtime with a built-in checker can ignore an
option it does not know (TC-1). Each passes the check while the protection is gone; only a fixture
that must fail notices.

**Enforced by:** Engineer — the fixture test, and the consumer's comparison test.

**Example:** [`tools/check-fixtures.ts`](../examples/tools/check-fixtures.ts),
[`test/fixtures/rejected/`](../examples/test/fixtures/rejected/).

### CP-4 (MUST) Run `.ts` directly, or emit, but decide which, and configure for it. (PROPOSED)
To run sources directly on Node: `module` and `moduleResolution` `nodenext`, relative imports
written with their `.ts` extension, `allowImportingTsExtensions` with `noEmit`. To emit for
publishing, `rewriteRelativeImportExtensions` instead. A library that others import is usually
emitted with declarations; a service is usually run directly.

Running directly, Node reads no `tsconfig.json`: an import through `paths` type-checks and then
fails with `ERR_MODULE_NOT_FOUND` (Node 26.12.1), so use relative imports or `package.json`
`imports`. Node also refuses to strip types from a file under `node_modules`
(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so TypeScript vendored into the project lives
outside it.

**Why:** the extension and resolution settings for the two cases conflict, and a mix produces
imports that type-check and then fail at run time.

**Enforced by:** Engineer — the check and the test run use the same resolution as production.
