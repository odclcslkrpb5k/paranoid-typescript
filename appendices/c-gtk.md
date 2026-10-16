# Appendix: Paranoid C (GTK 3)

How the core standard carries into C, for Linux desktop applications built on GTK 3 and GLib. Like
every appendix it defines no rules of its own: each section names the core rules it serves and says
what meets them in C, where C leaves a gap, and where GTK forces a deviation. A core rule not
mentioned here applies as written, wherever it applies; chapters 12 to 16 mostly do not, since a
desktop application is not a service.

C differs from TypeScript more than any other language this standard is likely to meet. Two
hazards the core never names come first: memory safety, and GTK's single UI thread. Both are judged
on the same ladder as every core rule. The good news is GLib: it already brings errors as values
(`GError`), owned containers and checked parsing, so much of the core maps onto conventions GTK
code should follow anyway.

**Status.** A draft, not yet used on a project: read every recommendation here as (PROPOSED). Each
named flag and behaviour was checked on 2026-10-16 on Debian trixie, with GCC 14.2, Clang 19.1,
GTK 3.24.49, GLib 2.84, Meson 1.7 and cppcheck 2.17, against the OpenSSF compiler hardening guide
dated 2026-08-20. GTK 3 is maintained as "oldstable" beside GTK 4, with one release a year since
2026; a new project weighs GTK 4 first.

## Memory safety: a hazard the core never meets

TypeScript cannot free memory twice; C can, and most serious C defects are of this kind. In ladder
order:

- **Eliminate the hand-written lifetime.** `g_autoptr`, `g_autofree` and `g_auto` free at the end
  of scope (GCC and Clang only), `g_steal_pointer` hands ownership on explicitly, and
  `g_clear_object` and `g_clear_pointer` free and null a field in one step, so a second clear is
  harmless. A function's ownership of what it returns is part of its interface and is written in
  its header comment, in GObject Introspection's terms (`transfer full`, `transfer none`).
- **Substitute** GLib for the C library's sharp edges: `GString`, `GPtrArray` with a free
  function, `g_strdup_printf`, and `g_new`, which refuses an allocation whose size overflows (it
  aborts with "overflow allocating"), where `malloc(n * size)` silently wraps.
- **Engineer.** A shared header poisons the functions that have no safe use: `#pragma GCC poison
  strcpy strcat sprintf vsprintf gets atoi atol system` turns any later use into a compile error,
  in GCC and Clang alike. Test builds run under AddressSanitizer and UndefinedBehaviorSanitizer
  (Meson's `-Db_sanitize=address,undefined`; `_FORTIFY_SOURCE` must be off in those builds). GCC's
  `-fanalyzer` finds a double `free` but not a double `g_free`, since GLib does not declare its
  allocators to the compiler: it sees only what goes through the C library's own functions.
- **Protect.** Compiler hardening (below) absorbs some of what escapes: a stack protector, a
  read-only relocation table, control-flow protection. It is the last rung, not a substitute for
  the others.

**Lifetimes in callbacks** cause most use-after-free in GTK code. A signal handler, a timeout or an
asynchronous callback can run after the object it was given has been finalized. Connect with
`g_signal_connect_object`, which disconnects when that object goes; in `dispose`, remove sources
with `g_clear_handle_id` and handlers with `g_clear_signal_handler`; and give every asynchronous
call a `GCancellable` that `dispose` cancels, whose callback checks for `G_IO_ERROR_CANCELLED`
before it touches its user data.

## One UI thread: the other hazard

GTK may be called only from the thread running the main loop. Work that blocks (file or network
I/O, a long computation) runs in a `GTask` thread or through GIO's asynchronous calls, and returns
its result to the main loop through the task's callback or `g_idle_add`. A blocking call on the
main thread freezes the window, which is the desktop's form of a missing deadline (SV-20). Missing
Engineer control: a check that fails when the main loop is blocked beyond a threshold in tests.

## Toolchain (chapter 01)

- **Environment (TC-1, TC-9).** The Dockerfile starts from a distribution image pinned by digest
  and installs the compiler, GTK's development packages and the tools. An apt package pinned to an
  exact version installs only while the mirror still carries it; for a build that reproduces next
  year, point apt at a dated `snapshot.debian.org` mirror.
- **Dependencies (TC-3).** System libraries come from the pinned image. A library vendored through
  a Meson wrap carries its `source_hash`, so a changed archive fails the build (RP-4).
- **Build (TC-5).** Meson and Ninja; the one check command builds, tests and runs every analyzer.
- **Formatter (TC-6).** `clang-format`, checked with `--dry-run --Werror`.
- **Compiler version (the counterpart of TC-8).** The compiler is pinned with the image: each
  version adds warnings, and an unpinned one turns the build red on its own schedule.

## Compiler settings (chapter 02)

**Warnings (CP-1).** Start from the OpenSSF guide's baseline and add what C needs:

    -std=c17 -Wall -Wextra -Wformat=2 -Wconversion -Wimplicit-fallthrough -Wswitch-enum
    -Wcast-qual -Wwrite-strings -Wvla -Wshadow -Wstrict-prototypes -Wmissing-prototypes
    -Werror=format-security -Werror=implicit -Werror=incompatible-pointer-types
    -Werror=int-conversion -Werror=deprecated-declarations

In C, `-Wconversion` includes `-Wsign-conversion`, in both compilers. `-Wwrite-strings` makes a
string literal `const`, so writing to one fails to compile. Meson's `werror=true` makes every
warning an error in CI; the OpenSSF guide keeps blanket `-Werror` out of distributed source,
because an unknown compiler adds warnings, and an application built in its own image is not
distributed that way.

**Deprecations.** `-DGLIB_VERSION_MIN_REQUIRED` and `-DGLIB_VERSION_MAX_ALLOWED`, and their `GDK_`
counterparts for GTK, set to the versions the project targets: a call deprecated by then, or newer
than the minimum, is a warning, and with the line above an error.

**Hardening, the Protect rung.** The OpenSSF guide's baseline, which both compilers accept:

    -O2 -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3 -fstrict-flex-arrays=3
    -fstack-clash-protection -fstack-protector-strong -fcf-protection=full -fPIE
    -fno-delete-null-pointer-checks -fno-strict-overflow -fno-strict-aliasing
    -ftrivial-auto-var-init=zero
    -pie -Wl,-z,relro -Wl,-z,now -Wl,-z,noexecstack -Wl,--as-needed

GCC adds `-Wtrampolines` and `-Wbidi-chars=any`; `-fzero-init-padding-bits=all` needs GCC 15.

**Everything is built the same way (CP-2):** tests, tools and fuzz targets, with the same warnings.

**Prove the settings are honoured (CP-3).** A flag misspelled in a build file, or dropped by a
build-system change, removes a protection silently. A test reads the built binary with `readelf`:
`BIND_NOW` and `PIE` in the dynamic flags, a `GNU_RELRO` segment, a `GNU_STACK` segment without
execute permission, and `__stack_chk_fail` and a `_chk` function among the symbols when the source
calls a fortified one. For warnings, one fixture per flag that must fail to compile.

## Static analysis (chapter 03)

- **Analyzers.** GCC's `-fanalyzer` (C only, and blind to GLib's allocators), the Clang static
  analyzer (`scan-build`), clang-tidy's `bugprone-*`, `cert-*` and `clang-analyzer-*` checks, and
  cppcheck. Each finds what the others miss and each has false positives, so an existing codebase
  turns each on behind a baseline (AD-2).
- **Escape hatches (LN-2).** A cast is C's `as`: `-Wcast-qual` refuses one that drops `const`.
  GObject's cast macros (`GTK_LABEL (widget)`) check the type at runtime; never define
  `G_DISABLE_CAST_CHECKS`, which turns them into plain casts. A `gpointer user_data` is C's
  `unknown`: one struct type per callback, cast back in one place.
- **Exhaustive switches (LN-3).** `-Wswitch-enum` warns about an enumeration value a switch does
  not handle even when the switch has a `default`, which is exactly LN-3's "a `default` does not
  count". (`-Wswitch`, in `-Wall`, accepts the `default`.)
- **Conditions (LN-5): a gap.** C has no check requiring a boolean condition: clang-tidy's
  `readability-implicit-bool-conversion` does not flag `if (pointer)` in C, as of clang-tidy 19.
- **Results are used (LN-6).** Every function that reports failure through its return value is
  declared `G_GNUC_WARN_UNUSED_RESULT`. In GCC, a `(void)` cast does not silence it; in Clang it
  does, as it does for C23's `[[nodiscard]]` in both. Prefer GLib's macro, and have the
  suppression check (LN-8) refuse `(void)` casts on calls.
- **Suppressions (LN-8).** `#pragma GCC diagnostic ignored`, `// NOLINT` and
  `// cppcheck-suppress` are refused by a check; an exception goes in the build file, scoped to its
  source files.
- **Architecture as rules (LN-9).** `#pragma GCC poison` for banned functions. Patterns the
  compiler cannot see — a `GError **` argument passed as `NULL`, a GTK call from a worker thread —
  are written for Coccinelle, the semantic patch tool the Linux kernel uses, or semgrep, each with
  examples that must and must not match.

## Errors (chapter 04)

GLib's `GError` is errors as values already (ER-1): a function returns `FALSE` or `NULL` on
failure and fills its last parameter, `GError **error`. The core's rules become its conventions:

- **The return value and the error agree:** `FALSE` exactly when the error is set. Setting an
  error that is already set is a bug, which GLib reports as a warning.
- **A `NULL` for `GError **` discards the failure (ER-6),** the C form of an empty `catch`. Pass
  one only where failure is truly irrelevant, and say why in a comment.
- **Branch on domain and code (ER-8):** `g_error_matches (error, G_IO_ERROR,
  G_IO_ERROR_NOT_FOUND)`, never `error->message`, which is translated and often quotes a path.
- **Adapters (ER-3).** Code that calls the C library or a system call turns `errno` into a
  `GError` at once (`g_file_error_from_errno`, `g_io_error_from_errno`). Prefer GIO, which reports
  through `GError` already.
- **Silent failures (ER-4).** C's sharp built-ins do not throw, they fail quietly: `atoi` returns 0
  for text that is not a number, and `strtol` signals failure only through `errno` and its end
  pointer. Use `g_ascii_string_to_signed` and `g_ascii_string_to_unsigned`, which take bounds and
  return a `GError`, and poison `atoi` and `atol`.

**Panics (ER-2).** `g_return_if_fail` and its kind check a caller's mistake, log a critical and
return. A critical is a bug: run development builds with `G_DEBUG=fatal-criticals`, which aborts on
the first one, and tests abort on them already, since `g_test_init` makes warnings and criticals
fatal. For a case the types rule out, call `g_error`, which always aborts, or a project macro that
calls `abort`. Never define `G_DISABLE_ASSERT` or `G_DISABLE_CHECKS`: the first compiles the
`g_assert` family out, and with it defined, `g_assert_not_reached` becomes undefined behaviour —
the probe for this appendix ran on past it into a segmentation fault.

**A critical returns a default (ER-7).** `g_variant_get` with the wrong format logs a critical and
leaves the output untouched, so the program carries on with a zero. Check `g_variant_is_of_type`
before reading a `GVariant` from outside (BD-1); `fatal-criticals` catches the rest in testing.

**Counted catch-all (ER-5, ER-9).** A log writer (`g_log_set_writer_func`) counts warnings and
criticals and records their domain, so a production build that does not abort on them still
reports them. A crash is the process-level handler's case: let the program abort and leave a core
dump for `systemd-coredump`, rather than install a handler that tries to carry on.

**Cancellation (ER-10).** A cancelled GIO call returns `G_IO_ERROR_CANCELLED`, which is neither
success nor failure: the caller stops without reporting an error and without touching anything
the cancellation was meant to release.

## Boundaries (chapter 05)

- **What counts as outside (BD-1):** files, the command line, the environment, D-Bus, the
  clipboard, drag and drop, and every document the application opens. Each is parsed once, where
  it enters, into a struct. `GKeyFile`'s typed getters and `GSettings` with a compiled schema
  (`glib-compile-schemas --strict`) parse configuration; json-glib parses JSON, with each node's
  type checked before it is read; `gdbus-codegen` generates D-Bus interfaces whose argument types
  GDBus checks.
- **Text.** GTK and Pango expect UTF-8, but a label set to invalid UTF-8 is not refused: validate
  with `g_utf8_validate` (or repair with `g_utf8_make_valid`) where text enters. A file name is
  bytes in the file system's encoding, not text; show it with `g_filename_display_name`.
- **Format strings.** `-Wformat=2` and `-Werror=format-security` refuse a format string that is not
  a literal. A project's own variadic functions are declared `G_GNUC_PRINTF` so they are checked
  too. Translations are a boundary as well: `msgfmt --check` refuses a translation whose format
  specifiers differ from the original (`%s` for `%d`), which would otherwise read the wrong type
  from the stack at runtime.
- **Coercions (BD-2)** in C: every cast, `GPOINTER_TO_INT` and its kind, `gpointer` user data,
  `memcpy` between different types, and any narrowing assignment `-Wconversion` reports.
- **Integer sizes (the counterpart of BD-4).** Arithmetic on sizes and counts uses C23's
  `ckd_add` and `ckd_mul` (`<stdckdint.h>`, in GCC 14 and Clang 19), or GLib's
  `g_size_checked_mul`, and allocation goes through `g_new`, which checks its own multiplication.
- **Brands (BD-5).** A single-member struct is a distinct type at no cost:
  `typedef struct { gint64 value; } DocumentId;`. The compiler refuses one kind of id where
  another is expected, and only the parse function builds one.
- **Time (BD-6).** `GDateTime` carries its zone; build from outside data with an explicit
  `GTimeZone`.

## Code (chapter 06)

- **Hidden characters (CD-7).** GCC's `-Wbidi-chars=any` refuses bidirectional controls in source;
  keep the repository-wide scan for the rest of CD-7's list.
- **Immutability (CD-8).** `const` on every pointer a function does not write through, with
  `-Wcast-qual` and `-Wwrite-strings` so the `const` cannot be cast away quietly.
- **Subprocesses.** `GSubprocess` or `g_spawn_async` with an argument vector; never a shell command
  built from strings (`system`, `popen`, `g_spawn_command_line_*`), and `system` is poisoned.

## Testing (chapter 07)

- **GTest under Meson,** with TAP output. `g_test_init` makes warnings and criticals fatal, and
  `g_test_trap_subprocess` tests that a panic does abort.
- **Leaks (TS-3).** LeakSanitizer runs with AddressSanitizer. GTK keeps caches for the life of the
  process, so even creating and destroying one window reports leaks (about 100 KB in 482
  allocations on the versions above): keep a suppressions file for GTK's own allocations, reviewed
  like a baseline (AD-2), so a leak of the application's own still fails. Valgrind is the slower
  alternative; GLib installs `glib.supp` for it.
- **Fuzz every parser (TS-16).** libFuzzer (`clang -fsanitize=fuzzer,address`) on each function
  that reads outside data is C's property test, and finds the memory errors property tests in safe
  languages cannot have. theft is a property-testing library for C.
- **Mutation (TS-5)** with Mull, which mutates through LLVM.
- **The interface.** Keep logic out of widgets so most tests need no display. Widget tests run
  under `xvfb-run -a`. `gtk-builder-tool validate` refuses a `.ui` file with an unknown property
  (it needs a display too), `desktop-file-validate` checks the desktop entry and `appstreamcli
  validate` the metadata. Compiling `.ui` files and icons into a `GResource` removes "the file is
  missing at runtime" as a failure.

## Data protection (chapter 11)

- **Secrets (DP-1)** go in the desktop's secret service through libsecret, never in a file under
  `~/.config`.
- **Debug logs are logs (DP-3).** `g_debug` output appears when a user sets `G_MESSAGES_DEBUG=all`,
  and users paste it into public bug reports. It names kinds and codes, not documents, paths or
  values; a `GError`'s message often quotes a path, which holds the user's name.

## What it does not replace

No flag finds a lifetime error the sanitizers never execute, a race between threads that tests do
not provoke, or an interface that misleads its user. Those stay with fuzzing, review and use.
