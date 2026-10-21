# Appendix: Paranoid Python (Django)

How the core standard carries into a Python backend built on Django. It defines no rules of its
own: each section names the core rules it serves and says what meets them in Python, where Python
leaves a gap, and where Django forces a deviation. A core rule not mentioned here applies as
written, wherever it applies.

Two differences shape everything below. Python's types are optional and erased at runtime, so
nothing stops a wrong value at the edge except a parser, and chapter 05 carries more of the weight
than it does in TypeScript. And Django assumes exceptions: transactions roll back, tasks retry and
error pages render on a raise, so errors as values (chapter 04) stop at the framework's edge.

**Status.** Adapted from the TypeScript core, and not yet proven rule by rule on a project: read
every recommendation here as (PROPOSED). Each named setting was checked on 2026-10-16 against
Python 3.13, Django 6.1, mypy 2.4, basedpyright 1.40, ruff 0.17, pydantic 2.14, pytest 9.1 and uv
0.13, and the type checkers again on 2026-10-19 with Pyrefly 1.4, basedpyright 1.40.2, mypy 2.4 and
django-stubs 6.1.2. The section on an existing codebase was checked on 2026-10-21 against DRF
3.18.3, drf-spectacular 0.30.0, graphene 3.4.3, graphene-django 3.2.3 and MariaDB 11.8.9, with the
MySQL error numbers taken from PyMySQL 1.2.3's constants. Tool options change between versions;
check each against the version you install.

## Toolchain (chapter 01)

- **Environment (TC-1, TC-9).** The Dockerfile starts from a `python` image pinned by digest, and
  `.python-version` names the same version for the tools that read it.
- **Lockfile (TC-3).** With uv, `uv.lock` is committed and the image runs `uv sync --locked`, which
  fails rather than re-locking when the lockfile and `pyproject.toml` disagree. Without uv, install
  a compiled requirements file with `pip install --require-hashes`.
- **No build code at install (TC-4).** Installing a source distribution runs its build code:
  Python's install script. `uv sync --no-build` (pip: `--only-binary :all:`) installs wheels only,
  and a dependency with no wheel for the image's platform becomes a review finding (TC-7). uv's
  `exclude-newer` gives a minimum release age; check which formats your version accepts.
- **Formatter (TC-6).** `ruff format --check` in the one check command.
- **Checker version (TC-8).** The type checker and django-stubs are pinned together, since the
  checker reads Django's types from the stubs. With mypy, django-stubs' `compatible-mypy` extra
  pins mypy to the range the stubs support; install through it rather than pinning mypy alone.

## The type checker (chapters 02 and 03)

Three type checkers fit. Pyrefly is the one that meets LN-6 and also types Django's ORM, so it is
the default; the others suit the cases below.

- **Pyrefly**, with `preset = "all"`, turns every check on as an error. `unused-call-result`
  refuses a discarded return value (LN-6), so a discarded `Result` fails with no custom rule.
  Through django-stubs it types the ORM as precisely as mypy's plugin: a `DecimalField` reads as
  `Decimal`, a nullable `TextField` as `str | None`, a `ForeignKey` as the related model, and
  `filter` returns `QuerySet[Order, Order]`. Without django-stubs installed every model's `objects`
  is a missing attribute and every field `Unknown`, so the stubs are a dependency, not an option.
  It is stricter than the stubs in one place: it refuses assigning a `str` to a `DecimalField`,
  which Django accepts and mypy allows. A baseline file (`--baseline`, `--update-baseline`) serves
  AD-2.
- **basedpyright**, with `typeCheckingMode = "all"`, has LN-6 too (`reportUnusedCallResult`) and a
  baseline (`--writebaseline`), but no Django plugin: with django-stubs installed, every model
  field is still "partially unknown", an error where it is declared and again wherever it is read.
  It suits a project that barely touches the ORM.
- **mypy** with django-stubs' plugin types the ORM as well as Pyrefly, but has no general
  unused-result check (`unused-awaitable` covers only awaitables). Its settings, where a project
  runs it:

  ```toml
  [tool.mypy]
  strict = true            # includes strict_equality, extra_checks and warn_unused_ignores
  warn_unreachable = true
  enable_error_code = [
    "ignore-without-code", "redundant-expr", "truthy-bool", "truthy-iterable",
    "possibly-undefined", "explicit-override", "unused-awaitable", "exhaustive-match",
  ]
  plugins = ["mypy_django_plugin.main"]
  ```

Pyrefly's settings are the preset and the paths: `[tool.pyrefly]` with `preset = "all"` and
`project-includes`. Whichever checker runs, install stubs for every dependency without inline
types: an untyped dependency is `Any`, and `Any` is the hole every other rule leaks through.

- **Gaps against CP-1.** There is no unchecked-index setting: `rows[0]` on a `list` and `d[key]` on
  a `dict` are never optional, in any of the three. Use `next(iter(rows), None)` or a helper
  returning `T | None`, and `.get(key)` with the `None` handled (never a default: ER-7).
- **Everything is checked (CP-2):** tests, management commands and scripts under the same settings.
  Generated migrations are the one exclusion, by path in the configuration.
- **Prove the settings are honoured (CP-3).** mypy reports a misspelled option as "Unrecognized
  option" and still exits 0, and Pyrefly does the same with "Extra keys found in config"; a
  misspelled preset name fails the parse, and Pyrefly then checks with its automatic configuration
  while exiting 1. Either way a typo can silently switch a check off. One fixture per setting that
  the setting must reject catches it.
- **Escape hatches (LN-2).** ruff's `ANN` rules require annotations and `ANN401` refuses an
  explicit `Any`. ruff's banned-api rule (`TID251`) refuses `typing.cast`. `assert x is not None`,
  Python's `x!`, vanishes under `python -O`: refuse it in application code with `S101` and use a
  `must(x, "what")` that raises.
- **Exhaustive matches (LN-3).** Pyrefly's `non-exhaustive-match-open-type`, mypy's
  `exhaustive-match` and basedpyright's `reportMatchNotExhaustive` refuse a `match` over a union
  that misses a member. A `case _:` that handles the rest silences all three, as a `default` does
  in TypeScript; over a union, the only `case _:` is one that calls `assert_never`.
- **Coroutines (LN-4).** Pyrefly's `unused-coroutine`, basedpyright's `reportUnusedCoroutine`,
  mypy's `unused-awaitable`, and ruff's `RUF006` for a task created and dropped.
- **Conditions (LN-5).** Pyrefly's `implicit-bool` refuses a condition that is not a `bool`: `if
  items:` on a list or an optional, `n` as a conditional expression's test, `not s` on a string,
  `while o:` and `a or b` on integers. mypy's `truthy-bool` and `truthy-iterable` refuse only
  conditions that are always true, and basedpyright has no such check.
- **Suppressions (LN-8).** `# type: ignore`, `# pyrefly: ignore`, `# pyright: ignore` and `# noqa`
  are refused like `eslint-disable`: a check fails on any of them. Until it exists, `PGH003` and
  `PGH004` refuse the blanket `type: ignore` and `noqa`, `RUF100` and the checkers' unused-ignore
  reports (Pyrefly's `unused-type-ignore`) remove stale ones, and basedpyright's
  `reportIgnoreCommentWithoutRule` requires a rule name. Pyrefly honours a bare `# pyrefly: ignore`
  and a blanket `# type: ignore` without a word, and `PGH003` reads only `type: ignore`, so the
  check must cover Pyrefly's comments itself. An exception goes in `per-file-ignores` or a checker
  override, scoped by path. ruff has no baseline file, so on an existing codebase a rule ratchets
  by a list of paths exempted from it that only shrinks (AD-2).
- **Architecture as rules (LN-9).** `TID251` bans a name outside the module allowed to use it, as
  `no-restricted-properties` does: `json.loads` outside the parsing module (ER-4), `os.environ`
  outside settings (SV-1). Syntax rules ruff cannot express ("raise only `Panic` outside adapters",
  "`except` only in adapters and entry-point nets") go in ast-grep or semgrep, each tested against
  code that must and must not match.

## Errors (chapter 04)

**A deviation from ER-1.** Domain and service code returns typed failures. Code that runs inside
the framework raises where the framework needs a raise, because the framework acts on nothing
else: `transaction.atomic()` rolls back on an exception, Celery retries on one, and a task that
returns normally is recorded as done. A project records this deviation with its reason (RP-6).

```python
from dataclasses import dataclass
from typing import NewType, assert_never

OrderId = NewType("OrderId", int)

@dataclass(frozen=True)
class Ok[T]:
    value: T

@dataclass(frozen=True)
class Err[E]:
    error: E

type Result[T, E] = Ok[T] | Err[E]

@dataclass(frozen=True)
class NotFound:
    key: OrderId

@dataclass(frozen=True)
class Refused:
    code: str

type LoadError = NotFound | Refused

def describe(e: LoadError) -> str:
    match e:
        case NotFound():
            return "not found"
        case Refused(code=code):
            return f"refused: {code}"
        case _:
            assert_never(e)
```

- **Where the framework needs a raise (ER-1, ER-6),** raise in your own words, carrying the typed
  failure: inside `atomic()` to roll back (or call `transaction.set_rollback(True)`, which needs no
  raise), in a task to trigger its retry. Returning the failure there commits a failed transaction
  or records a failed task as done.
- **Throwing built-ins (ER-4).** `json.loads`, `decimal.Decimal`, `uuid.UUID`,
  `datetime.fromisoformat` and their kind live in one wrapper module returning `Result`s, and
  `TID251` bans them elsewhere. Builtins such as `int()` and `float()` cannot be banned by name;
  they stay with coercion review (BD-2).
- **Counted catch-alls (ER-5)** at every entry point: a middleware's `process_exception` for views,
  Celery's `task_failure` signal for tasks, a wrapper around each management command. Each records
  the exception's class, never its message.
- **Failures into success (ER-6):** ruff's `BLE001` (blind `except Exception`), `S110` and `S112`
  (`except` with only `pass` or `continue`).
- **Database errors by code (ER-8).** Django wraps a driver error in its own class and keeps the
  original as `__cause__`; branch on the driver's SQLSTATE (`sqlstate` in psycopg 3, `pgcode` in
  psycopg 2), never on `str(e)`.
- **The process-level handler (ER-9):** `sys.excepthook`, `threading.excepthook` and, where asyncio
  runs, the loop's exception handler.
- **Aborts (ER-10).** Celery raises `SoftTimeLimitExceeded` inside the task when its soft limit
  passes; a broad `except` in the task catches it and carries on with a run that was cut short.

## Boundaries (chapter 05)

- **Parse with a strict model (BD-1).** pydantic v2 coerces by default: `"7"` becomes `7` and
  `"yes"` becomes `True`. `ConfigDict(strict=True)` refuses the wrong type instead, in Python and
  JSON validation alike. Parse bytes directly (`model_validate_json`); `json.loads`,
  `request.body` and `cursor.fetchall()` give `Any` or untyped tuples, the same trap as
  `JSON.parse`. pydantic ignores extra members by default, which suits what you read; set
  `extra="forbid"` on what you accept, so a misspelled member in a request is refused, not dropped.
  msgspec is a faster alternative.
- **Views.** django-ninja declares pydantic schemas per endpoint. DRF serializers type poorly: a
  project that keeps them converts `validated_data` into a model or frozen dataclass at once.
- **Coercions (BD-2)** in Python: `cast`, `Any`, a suppression comment, `int()`, `float()`,
  `str()` or `bool()` on outside data, `getattr` or `setattr` with a computed name,
  `Model.objects.create(**data)` (which hides a wrong field and a wrong type, as `Object.assign`
  does), `.extra()` and `RawSQL` (ruff `S611`) and SQL built from strings (`S608`). Test fixtures
  are built through typed builder functions for the same reason, never `create(**dict)`.
- **64-bit integers (BD-4)** are no hazard inside Python, whose integers are unbounded. They are at
  the edge: a key above 2^53 sent as a JSON number loses precision in a JavaScript client. Send
  such keys as strings.
- **Brands (BD-5).** `OrderId = NewType("OrderId", int)` costs nothing at runtime and checks
  nothing: `OrderId(-5)` type-checks. So the brand's parse function is the only code that calls
  the constructor, enforced by an ast-grep rule, and it returns a `Result`. The ORM's `.pk`, `.id`
  and `_id` fields are plain `int`: wrap them in the one layer that touches the ORM, and unwrap
  only to build a query. Money is `Decimal` built from text, never through `float`.
- **Time zones (BD-6).** `USE_TZ = True`, and ruff's `DTZ` rules refuse a naive `datetime`.

## Code (chapter 06)

- **Hidden characters (CD-7).** ruff's `PLE2502` (bidirectional controls), `PLE2510` to `PLE2515`
  (control characters and the zero-width space) and `RUF001` to `RUF003` (look-alikes) cover part
  of CD-7's list, not all of it; keep the repository-wide scan.
- **Immutability (CD-8).** Frozen dataclasses, pydantic's `frozen=True`, tuples, and `Sequence` and
  `Mapping` in signatures, which the checker treats as read-only.

## Testing (chapter 07)

- **pytest at its strictest:** `strict = true` (strict configuration, markers, xfail and
  parametrization ids) and `filterwarnings = ["error"]` (TS-18). A deliberate warning is allowed
  by an exact `ignore:` entry in that list, never by a blanket one.
- **Leaks (TS-3).** An unclosed file or socket raises `ResourceWarning` when it is collected; with
  warnings as errors, pytest fails the test. This sees only what Python warns about: a pool
  connection never returned is not one.
- **The real engine (TS-2).** Django's test runner creates its database on the configured engine;
  never swap in SQLite for speed.
- **Loopback over fakes (TS-9).** `responses`, `requests-mock` and `respx` intercept inside the
  client library, so they are fakes of its own interface: a call that dropped its timeout passes
  them. Test the client against a loopback server, such as pytest-httpserver's.
- **Recorded fixtures (TS-11).** vcrpy cassettes are recorded from the real service, as TS-11 asks,
  and hold its real values: scrub them before they are committed (DP-1).
- **Mutation (TS-5)** with mutmut or cosmic-ray; **properties (TS-16)** with hypothesis.

## Databases (chapters 13 and 14)

- **A deviation from DB-5.** Django migrations are Python, generated from the models, and rewriting
  them as SQL would lose the model state Django builds from them. DB-5 exists so that people read a
  migration as SQL: review `manage.py sqlmigrate` output with each migration, and run
  `manage.py makemigrations --check --dry-run` in the check command, which fails when models and
  migrations disagree (TS-7).
- **The advisory lock (DB-4).** `manage.py migrate` takes no lock, so two instances booting at once
  both migrate. Wrap it in a command that takes a Postgres advisory lock first, or run it as a
  single release step.

## Services (chapter 12)

- **Configuration (SV-1).** `settings.py` builds itself from one pydantic-settings model, which
  refuses to boot on bad configuration; `TID251` bans `os.environ` and `os.getenv` elsewhere.
- **Production settings (SV-3).** `manage.py check --deploy --fail-level WARNING` fails on a
  `SECRET_KEY` Django marks insecure, such as the one `startproject` writes into the repository,
  and on `DEBUG = True` and Django's other unsafe deployment settings. Run it at boot or in the
  release step.
- **Deadlines (SV-20).** `requests` has no default timeout, and ruff's `S113` refuses a call
  without one. Postgres's server-side bounds go in the connection's `OPTIONS`
  (`"options": "-c statement_timeout=... -c lock_timeout=..."`), and the connection pool, where one
  is used, has an acquire timeout. A Celery task has `soft_time_limit` and `time_limit`, and both
  fit inside the worker's stop grace period (SV-4): Celery's warm shutdown waits for running tasks.
- **Retries (SV-21).** Celery's `autoretry_for=(Exception,)` retries everything, a 400 included;
  name the transient classes instead.

## Data protection (chapter 11)

- **Error reporters capture data (DP-3).** Sentry's Python SDK sends local variables and request
  bodies by default: set `include_local_variables=False` and `max_request_body_size="never"`.
  Django's error emails and debug pages filter settings by name, which is a deny-list; send counted
  events instead (ER-5), and keep `DEBUG` off with `check --deploy` (above).
- **Validation messages quote input.** pydantic's `errors()` includes the refused value; use
  `errors(include_input=False, include_url=False)` and keep `loc` and `type`.

## An existing codebase: DRF, graphene and MySQL

The sections above assume a new project: pydantic or django-ninja at the boundary, Postgres
underneath. An existing application more often has DRF serializers, graphene and MySQL or MariaDB.
What changes:

- **Response schemas from DRF (BD-8).** drf-spectacular merges request and response into one
  component unless `COMPONENT_SPLIT_REQUEST = True`; turn it on. Even split, a response component's
  `required` list comes from each serializer field's `required`, which is an input notion: a field
  with a model default is optional in every response although the server always sends it
  (drf-spectacular 0.30.0). Fix it at the owner, with a postprocessing hook
  (`POSTPROCESSING_HOOKS`) or a response serializer that declares such fields `read_only`, and
  prove it with BD-8's test, which serializes real rows and validates them against the published
  schema.
- **A missing object serializes as a record (BD-8).** `Serializer(None).data` is a dict of field
  defaults, not `None`: every string field `""`, a nullable column included, and no key (DRF
  3.18.3). A view that may have no object checks for `None` before serializing.
- **graphene's nullability (BD-8).** graphene-django's `DjangoObjectType` derives non-null from the
  column (`title: String!` for a non-null `CharField`), but a hand-declared `graphene.String()` is
  nullable unless it says `required=True` (graphene 3.4.3, graphene-django 3.2.3). Check the
  hand-declared fields first.
- **Database errors by code (ER-8).** mysqlclient's error carries the server's error number as
  `args[0]`, on the `__cause__` Django keeps: 1062 a duplicate key, 1452 a missing parent row, 1451
  a row still referenced, 1048 a null in a `NOT NULL` column, 1213 a deadlock, 1205 a lock wait
  timeout. MariaDB uses the same numbers.
- **The advisory lock (DB-4)** on MySQL is `GET_LOCK(name, timeout)`, released by `RELEASE_LOCK`,
  held by the connection.
- **The engine (TS-2).** MariaDB is not MySQL. `CAST(... AS JSON)` works on MySQL and is a syntax
  error on MariaDB 11.8, so CI runs the production engine, not the fork.

## What it does not replace

The checker cannot see what a query does, which lock a transaction takes, or whether a permission
check fails open. Django's ORM is dynamic enough that `values()`, `annotate()` and reverse
relations stay partly untyped even with stubs. Those stay with tests against the real database and
with review.
