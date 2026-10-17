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

**Status.** One project has adopted this appendix: a GTK 3 file manager of about 12,000 lines of C,
written by an agent, which turned it on step by step behind a baseline (AD-2) and planted a bug
against every control it added to watch the check fail. It built on Ubuntu 26.04 with GCC 15.2,
Clang 21.1, GTK 3.24.52, GLib 2.88, Meson 1.10 and cppcheck 2.19. The draft was first checked on
Debian trixie with GCC 14.2, Clang 19.1, GTK 3.24.49 and GLib 2.84, against the OpenSSF compiler
hardening guide dated 2026-08-20, and the claims both setups touched were checked on both. What
that project did not use is marked (PROPOSED). GTK 3 is maintained as "oldstable" beside GTK 4,
with one release a year since 2026; a new project weighs GTK 4 first.

On that project no compiler flag or analyzer found a real defect in existing code. The defects
came from a machine-made list read by a person, from grep, and from the existing tests, as the core
expects: the machine checks keep a fixed defect from coming back and make the rest expressible.

## Memory safety: a hazard the core never meets

TypeScript cannot free memory twice; C can, and most serious C defects are of this kind. In ladder
order:

- **Eliminate the hand-written lifetime.** `g_autoptr`, `g_autofree` and `g_auto` free at the end
  of scope (GCC and Clang only), `g_steal_pointer` hands ownership on explicitly, and
  `g_clear_object` and `g_clear_pointer` free and null a field in one step, so a second clear is
  harmless. Whether a caller owns what a function returns is part of its interface and is written
  in its header comment; GObject Introspection's `(transfer full)` annotations matter only to a
  library that generates bindings (PROPOSED), since no checker reads either wording.
- **Substitute** GLib for the C library's sharp edges: `GString`, `GPtrArray` with a free
  function, `g_strdup_printf`, and `g_new`, which refuses an allocation whose size overflows (it
  aborts with "overflow allocating"), where `malloc(n * size)` silently wraps.
- **Engineer: poison what has no safe use.** A header force-included into every source file
  (`-include`) ends with `#pragma GCC poison`, which makes any later use a compile error in GCC and
  Clang alike. The list that held up in practice: `strcpy strcat strncpy strncat sprintf vsprintf
  gets strtok atoi atol atoll atof system popen alloca`, and from GLib `g_alloca g_newa g_error
  g_spawn_command_line_sync g_spawn_command_line_async`; the nested main loops and thread exits
  below join it. Two traps: every system header must be included before the pragma (the prelude
  includes them), and a name that is also a macro (`g_error`, `alloca`) must be `#undef`ined first,
  or a use through the macro is never seen. Each ban gets a configure-time probe that must fail to
  compile (Meson's `cc.compiles`), so a ban that stops biting fails the build (LN-9).
- **Engineer: sanitizers.** Tests run under AddressSanitizer, UndefinedBehaviorSanitizer and
  LeakSanitizer (Meson's `-Db_sanitize=address,undefined`), with `_FORTIFY_SOURCE` off in those
  builds. Ubuntu's GCC defines `_FORTIFY_SOURCE=3` by itself whenever it optimises, so a sanitizer
  build above `-O0` passes `-U_FORTIFY_SOURCE` explicitly.
- **Engineer: teach the analyzer GLib.** GCC's `-fanalyzer` sees only the C library's allocators:
  untaught, it found none of six planted GLib memory bugs. A header included only in the analyzer
  build redeclares GLib's allocators with their deallocators, after which it found all six (double
  `g_free`, use after `g_free`, a `g_autofree` freed again by hand, a `g_strsplit` result freed
  with `g_free`, `g_malloc` freed with `free`, a leak on an early return):

      #undef g_strdup
      extern gpointer (g_malloc) (gsize) __attribute__ ((malloc, malloc (g_free, 1),
          malloc (g_free_sized, 1), returns_nonnull));

  and likewise `g_malloc0`, `g_malloc_n` and `g_malloc0_n` (which `g_new` expands to),
  `g_strdup`, `g_strndup`, `g_strdup_printf`, `g_build_filename`, `g_path_get_dirname` and their
  kind; `g_strsplit` takes `malloc (g_strfreev, 1)`. Name both deallocators, since `g_free` is a
  macro that picks `g_free_sized` when it can; parenthesise the names, since `g_strdup` is a macro
  for an inline wrapper, and `#undef` it, or every `g_autofree` assigned from it reads as leaked.
  Keep the header out of real builds: `returns_nonnull` is a promise to the optimiser, and
  `g_malloc (0)` returns `NULL`. Clang's analyzer found three of the six and cppcheck none. On GCC
  15.2 one false positive remains: an allocation returned by a function in the same file into a
  `g_autofree` variable reads as leaked, caused by GLib's untyped cleanup helper, so the analyzer
  build turns off `-Wanalyzer-malloc-leak` and leaves leaks to LeakSanitizer. The attribute also
  turns on the ordinary compiler warning `-Wmismatched-dealloc`.
- **Protect.** Compiler hardening (below) absorbs some of what escapes: a stack protector, a
  read-only relocation table, control-flow protection. It is the last rung, not a substitute for
  the others.

**Lifetimes in callbacks** cause most use-after-free in GTK code: a signal handler, a timeout or an
asynchronous callback can run after the object it was given has been finalized.

- **Eliminate: one module registers.** One source file is the only place allowed
  `g_signal_connect*`, `g_idle_add*`, `g_timeout_add*`, `g_source_attach`, `g_unix_fd_add`,
  `g_io_add_watch` and `gdk_threads_add_*`, which are poisoned everywhere else. Its functions take
  an owner, and every connection and source is removed when its owner is disposed. A count of live
  registrations is asserted to be zero when each test ends and when the program exits; it caught a
  leaked `GtkMenu`, which is a toplevel and is not destroyed with the widget it is attached to. An
  asynchronous call holds its owner through a `GWeakRef` and drops the result if the owner has
  gone, and it carries a `GCancellable` that `dispose` cancels.
- **Without such a module (PROPOSED),** connect with `g_signal_connect_object`, which disconnects
  when that object goes, and in `dispose` remove sources with `g_clear_handle_id` and handlers with
  `g_clear_signal_handler`. That is Engineer for the connection and Administer for the rest.

**Nested main loops** are a reentrancy hazard: while `gtk_dialog_run`, `gtk_main`,
`g_main_loop_run` or a `gtk_clipboard_wait_*` call waits, every other handler can run, on state the
caller assumed was still. Poison them, along with `pthread_cancel`, `pthread_exit` and
`g_thread_exit`, and use asynchronous responses (`GtkDialog::response`, `gtk_clipboard_request_*`);
the application's single loop is `g_application_run`.

## One UI thread: the other hazard

GTK may be called only from the thread running the main loop. Work that blocks (file or network
I/O, a long computation) runs in a `GTask` thread or through GIO's asynchronous calls, and returns
its result to the main loop through the task's callback or `g_idle_add`. A blocking call on the
main thread freezes the window, which is the desktop's form of a missing deadline (SV-20). Some
GIO and GTK calls block on D-Bus without saying so: `g_volume_monitor_get` takes about 20 ms with
gvfs running, and `gtk_mount_operation_new` makes a synchronous session-bus call.

**The stall watch (Engineer).** Tests fail when one of the application's callbacks holds the main
loop longer than a threshold, and name the callback. Time callbacks where they are registered (the
registration module above), not around the poll loop, whose gaps include test code. GLib allows
one pair of marshal guards per closure and `g_object_watch_closure` already takes it, so wrap
`g_cclosure_marshal_generic` in a meta-marshal installed only while the watch is on, which leaves
production closures their fast marshallers; register through macros that pass `#callback`, so the
failure reads "main loop blocked for 301 ms by source on_scanner_wake". Measured under
AddressSanitizer, the worst callback in that project's suite took 85 ms and its tests use 250. The
watch measures time, so a host busy with other work can make it fail: run the check alone.

Missing Engineer control: a check that a GTK function is never called from a worker thread. Until
there is one, workers own no GTK objects, by construction.

## Toolchain (chapter 01)

- **Environment (TC-1, TC-9).** The Dockerfile starts from a distribution image pinned by digest
  and installs the compiler, GTK's development packages and the tools. An apt package pinned to an
  exact version installs only while the mirror still carries it; for a build that reproduces next
  year, install from a dated snapshot: `snapshot.debian.org`, or on Ubuntu `snapshot.ubuntu.com`
  with `apt-get update --snapshot 20261016T000000Z` (apt 2.7 or later). The snapshot service is
  HTTPS only and the base image has no CA certificates, so install `ca-certificates` from the live
  archive first. `apt-get update` exits 0 when an index fails to download and the install then
  proceeds from what it got, so pass `--error-on=any` (TS-6). A date in the future is not refused:
  the newest snapshot is served.
- **Dependencies (TC-3).** System libraries come from the pinned image. A library vendored through
  a Meson wrap carries its `source_hash`, so a changed archive fails the build (RP-4) (PROPOSED).
- **Build (TC-5).** Meson and Ninja; the one check command builds, tests and runs every analyzer.
- **Formatter (TC-6).** `clang-format`, checked with `--dry-run --Werror`. For code in GTK's
  style the options that matter are `AlignTrailingComments: {Kind: Leave}`, `AlignEscapedNewlines:
  DontAlign`, `SpaceAfterCStyleCast: true` and `AllowShortCaseLabelsOnASingleLine: true`; tuned to
  the existing hand style it still rewrote 3.4% of lines, so list the formatting commit in
  `.git-blame-ignore-revs`.
- **Compiler version (the counterpart of TC-8).** The compiler is pinned with the image: each
  version adds warnings, and an unpinned one turns the build red on its own schedule.

## Compiler settings (chapter 02)

**Warnings (CP-1).** Meson's `warning_level=3` (`-Wall -Wextra -Wpedantic`) and `werror=true`,
plus:

    -std=gnu23 -Wformat=2 -Wconversion -Wimplicit-fallthrough -Wswitch-enum -Wcast-qual
    -Wwrite-strings -Wvla -Wshadow -Wmissing-prototypes

and, in GCC, `-Wsuggest-attribute=format` (below). GTK's headers compile cleanly with all of it in
both compilers. Flags that look useful but add nothing here, each shown by its fixture:
`-Wstrict-prototypes` does nothing in C23, where `int f()` is a prototype; `-Wsign-conversion` is
part of `-Wconversion` in C; `-Wpointer-arith` is part of `-Wpedantic`; `-Wmissing-declarations`
is the same check as `-Wmissing-prototypes` in C; and `-Werror=implicit`,
`-Werror=incompatible-pointer-types` and `-Werror=int-conversion` are errors by default since GCC
14. `-Wimplicit-fallthrough` is part of GCC's `-Wextra` but not Clang's, so it stays for the Clang
builds. The OpenSSF guide keeps blanket `-Werror` out of distributed source, because an unknown
compiler adds warnings; an application built in its own image is not distributed that way.

**Deprecations.** `-DGLIB_VERSION_MIN_REQUIRED` and `-DGLIB_VERSION_MAX_ALLOWED`, and their `GDK_`
counterparts for GTK, set to the versions the project targets: a call deprecated by then, or newer
than the minimum, is a warning, and with `werror` an error.

**Hardening, the Protect rung.** The OpenSSF guide's baseline, which both compilers accept:

    -O2 -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3 -fstrict-flex-arrays=3
    -fstack-clash-protection -fstack-protector-strong -fcf-protection=full -fPIE
    -fno-delete-null-pointer-checks -fno-strict-overflow -fno-strict-aliasing
    -ftrivial-auto-var-init=zero
    -pie -Wl,-z,relro -Wl,-z,now -Wl,-z,noexecstack -Wl,--as-needed

GCC adds `-Wtrampolines`, `-fzero-call-used-regs=used-gpr` and, from GCC 15,
`-fzero-init-padding-bits=all`.

**Everything is built the same way (CP-2):** tests and tools with the same warnings. The
exception is fuzz targets, which need Clang's libFuzzer and build with the subset Clang accepts.

**Prove the settings are honoured (CP-3).** For warnings, one fixture per flag that must fail to
compile with the full list and compile without that one flag, and a second set proving each
protection the list dropped as redundant still holds, whatever now provides it. Putting
`-Wstrict-prototypes` back fails the build. Three traps: Meson's `cc.compiles` leaves out
`warning_level`'s flags, so spell them out; `-fsyntax-only` skips the passes that emit some
warnings, `-Wimplicit-fallthrough` among them, so compile to an object; and a few warnings
(`-Wnull-dereference`) appear only with optimisation. For hardening, reading the binary with
`readelf` (`BIND_NOW`, `PIE`, `GNU_RELRO`, a non-executable `GNU_STACK`, `__stack_chk_fail`, a
`_chk` function) is weak where the distribution turns hardening on by default: on Ubuntu, a debug
build with none of the flags passed every property but fortification. GCC records each compilation
unit's options in its debug information (`DW_AT_producer`, on by default), so with `-g` the check
requires every unit to carry each code-generation flag, including those `readelf` cannot see
(`-ftrivial-auto-var-init`, `-fno-strict-overflow`, `-fstrict-flex-arrays=3`); the debug build
then fails ten checks, as it should.

## Static analysis (chapter 03)

- **Analyzers.** GCC's `-fanalyzer` taught GLib's allocators (above) leads on memory. clang-tidy's
  `bugprone-*`, `cert-*` and `clang-analyzer-*` checks and cppcheck each run behind a baseline
  (AD-2) counted per tool, check and file, which also fails when a fix leaves its entry behind, so
  a fix lowers the baseline in the same commit. `scan-build` reported nothing clang-tidy's
  `clang-analyzer-*` did not: run one of the two. On existing GTK code the raw counts were about
  790 for clang-tidy and 180 for cppcheck, none of them a real defect; most need configuring away
  for GLib, with each exclusion's reason written beside it: `bugprone-casting-through-void` fires
  on every GObject cast macro, and the reserved-identifier checks on GLib's own macros. cppcheck's
  unique contribution was missing `const` (CD-8).
- **Analyzer blind spots.** Clang's analyzer never runs `__attribute__((cleanup))` functions, so
  every `g_autofree` on an allocation it models reads as a leak (`unix.Malloc`), on Clang 19 and
  21. Clang 21's analyzer does not model C23's `va_start`, so under `-std=c23` or `gnu23` every
  variadic function reads as using an uninitialized `va_list`; turn that check off.
- **Tools that check nothing and pass (TS-6).** `scan-build --status-bugs` exits 0 with `-plist`
  or `-sarif`. cppcheck given a directory as `--project`, or an unknown `--library`, checks nothing
  and exits 0, and it stops reading a file at a macro it does not know, reporting that as one
  finding among many: give it a `.cfg` that defines `G_GNUC_PRINTF` and the project's no-return
  function, and assert that every entry of `compile_commands.json` appears among the files it says
  it checked.
- **Escape hatches (LN-2).** A cast is C's `as`: `-Wcast-qual` refuses one that drops `const`.
  GObject's cast macros (`GTK_LABEL (widget)`) check the type at runtime; the shared header
  `#error`s if `G_DISABLE_CAST_CHECKS` is defined, since it turns them into plain casts. A
  `gpointer user_data` is C's `unknown`: one struct type per callback, cast back in one place.
- **Exhaustive switches (LN-3).** `-Wswitch-enum` warns about an enumeration value a switch does
  not handle even when the switch has a `default`, which is exactly LN-3's "a `default` does not
  count" (`-Wswitch`, in `-Wall`, accepts the `default`). Livable in practice: 28 switches, no
  suppressions. It cannot see a switch over an `int`, which is what GTK dialog responses and key
  values are.
- **Conditions (LN-5): a gap.** C has no check requiring a boolean condition: clang-tidy's
  `readability-implicit-bool-conversion` does not flag `if (pointer)` or `if (count)` in C, as of
  clang-tidy 21.
- **Results are used (LN-6).** Every function that reports failure through its return value is
  declared with C23's `[[nodiscard]]`, and a check requires it on every function that takes a
  `GError **` and returns a value (it found sixteen unmarked). A cast silences it: `(void)` does in
  both compilers, and `(void) !` silences GLib's `G_GNUC_WARN_UNUSED_RESULT` in GCC too, so the
  suppression check (LN-8) refuses both spellings on a call.
- **Suppressions (LN-8).** `#pragma GCC diagnostic`, `NOLINT` and `cppcheck-suppress` comments
  and `(void)` casts on calls are refused by a script; an exception lives in the script, per file,
  with an exact count and a reason.
- **Architecture as rules (LN-9).** Patterns the compiler cannot see are a script over the
  preprocessed source, each rule with examples that must and must not match, run before the rules.
  `gcc -E -P` of the shared header yields every GLib, GTK and project prototype fully expanded,
  which is how the script knows the 676 functions taking a `GError **`. Coccinelle 1.3 could not
  see GLib's prototypes through their declaration macros (`GLIB_AVAILABLE_IN_ALL`). One rule found
  the only kind of bug no compiler or analyzer reported: an argument that reads `x` beside another
  that passes `&x` to a nested call, as in `agree (run (&error), error)`, whose order of evaluation
  C leaves open; GCC read `error` first, and every failed copy aborted on the agreement check
  under Errors.

## Errors (chapter 04)

GLib's `GError` is errors as values already (ER-1): a function returns `FALSE` or `NULL` on
failure and fills its last parameter, `GError **error`. The core's rules become its conventions:

- **The return value and the error agree:** `FALSE` exactly when the error is set, and the caller
  aborts when they disagree. Setting an error that is already set is a bug, which GLib reports as a
  warning.
- **A `NULL` for `GError **` discards the cause (ER-6).** List every such call by machine; a
  person reads each one. On the project above, 18 of 19 handled the failure through the return
  value, and the nineteenth was a real defect: it reported "Permission denied" for every reason a
  folder could not be opened. No test or analyzer would have found it. A check refuses the case
  that leaves no trace at all, a `NULL` error with the return value discarded.
- **Branch on domain and code (ER-8):** `g_error_matches (error, G_IO_ERROR,
  G_IO_ERROR_NOT_FOUND)`, never `error->message`, which is translated and often quotes a path. A
  check refuses comparisons with `->message`.
- **Adapters (ER-3).** Code that calls the C library or a system call turns `errno` into a
  `GError` at once (`g_file_error_from_errno`, `g_io_error_from_errno`), with the `errno` it
  actually got. Prefer GIO, which reports through `GError` already.
- **Silent failures (ER-4).** C's sharp built-ins do not throw, they fail quietly: `atoi` returns 0
  for text that is not a number, and `strtol` signals failure only through `errno` and its end
  pointer. Use `g_ascii_string_to_signed` and `g_ascii_string_to_unsigned`, which take bounds and
  return a `GError`; the `ato*` family is poisoned.

**Panics (ER-2).** `g_return_if_fail` and its kind check a caller's mistake, log a critical and
return. A critical is a bug: run development builds with `G_DEBUG=fatal-criticals`, which aborts on
the first one, and tests abort on them already, since `g_test_init` makes warnings and criticals
fatal. For a case the types rule out, call a project function declared `[[noreturn]]` and
`G_GNUC_PRINTF` that logs and calls `abort`, and poison `g_error`: GCC's analyzer reports the loop
that ends `g_error` as infinite (`-Wanalyzer-infinite-loop`, GCC 14 and 15). The shared header
`#error`s if `G_DISABLE_ASSERT` or `G_DISABLE_CHECKS` is defined. The first compiles out `g_assert`
and makes `g_assert_not_reached` undefined behaviour: in probes it fell silently into the next
`case` and returned that case's value, in GCC and Clang, with no warning. The `g_assert_true`
family is not compiled out, but under GLib's test harness `g_assert_nonnull` can return, so code
after it is not proven safe; use the project's own abort.

**A critical returns a default (ER-7) (PROPOSED).** `g_variant_get` with the wrong format logs a
critical and leaves the output untouched, so the program carries on with a zero. Check
`g_variant_is_of_type` before reading a `GVariant` from outside (BD-1); `fatal-criticals` catches
the rest in testing. A `GVariant` that is only a `GAction`'s parameter is checked by `GAction`.

**Counted catch-all (ER-5, ER-9).** A crash is the process-level handler's case: let the program
abort and leave a core dump for `systemd-coredump`, rather than install a handler that tries to
carry on. A desktop application needs no counting log writer: GLib's default writer already sends
every warning to the journal with its domain, and tests make warnings fatal. A writer that counts
(`g_log_set_writer_func`) is worth it only where something reads the count (PROPOSED).

**Cancellation (ER-10).** A cancelled GIO call returns `G_IO_ERROR_CANCELLED`, which is neither
success nor failure: the caller stops without reporting an error and without touching anything
the cancellation was meant to release.

## Boundaries (chapter 05)

- **What counts as outside (BD-1):** files, the command line, the environment, D-Bus, the
  clipboard, drag and drop, and every document the application opens. Each is parsed once, where
  it enters, into a struct. `GKeyFile`'s typed getters parse configuration, all or nothing. Not yet
  used on a project (PROPOSED): `GSettings` with a compiled schema (`glib-compile-schemas
  --strict`), json-glib with each node's type checked before it is read, and `gdbus-codegen`
  interfaces whose argument types GDBus checks.
- **Text.** GTK and Pango expect UTF-8, but a label set to invalid UTF-8 is not refused: validate
  with `g_utf8_validate` (or repair with `g_utf8_make_valid`) where text enters. A file name is
  bytes in the file system's encoding, not text; show it with `g_filename_display_name`.
- **Format strings.** `-Wformat=2` refuses a format string that is not a literal, and GCC's
  `-Wsuggest-attribute=format` makes a project's own variadic function without `G_GNUC_PRINTF` a
  build error, so its callers are checked too (Clang has no such flag). Translations are a boundary
  as well: `msgfmt --check` refuses a translation whose format specifiers differ from the original
  (`%s` for `%d`), which would otherwise read the wrong type from the stack (PROPOSED).
- **Coercions (BD-2)** in C: every cast, `GPOINTER_TO_INT` and its kind, `gpointer` user data,
  `memcpy` between different types, and any narrowing assignment `-Wconversion` reports.
- **Integer sizes (the counterpart of BD-4).** Arithmetic on sizes and counts uses C23's
  `ckd_add` and `ckd_mul` (`<stdckdint.h>`, in GCC 14 and Clang 19), or GLib's
  `g_size_checked_mul`, and allocation goes through `g_new`, which checks its own multiplication.
  Constants that take part in size arithmetic are typed (`size_t`), which clang-tidy's
  `bugprone-implicit-widening-of-multiplication-result` points out.
- **Brands (BD-5) (PROPOSED).** A single-member struct is a distinct type at no runtime cost:
  `typedef struct { gint64 value; } DocumentId;`. The compiler refuses one kind of id where
  another is expected, and only the parse function builds one. Every use pays in syntax, so it
  earns its place where several kinds of id share one integer type.
- **Time (BD-6).** `GDateTime` carries its zone; build from outside data with an explicit
  `GTimeZone`.

## Code (chapter 06)

- **Hidden characters (CD-7).** GCC 15 refuses bidirectional controls in source by default (GCC
  14 needs `-Wbidi-chars=any`); keep the repository-wide scan for the rest of CD-7's list, over
  build files and scripts as well as C.
- **Immutability (CD-8).** `const` on every pointer a function does not write through, with
  `-Wcast-qual` and `-Wwrite-strings` so the `const` cannot be cast away quietly. cppcheck finds
  the missing ones; each round of fixes exposes more, and three rounds settled one codebase. It
  cannot be complete in GObject code: `G_DEFINE_TYPE` fixes the signatures of `_init` and
  `_class_init`, and `g_atomic_int_get` casts its argument to non-`const`, which `-Wcast-qual`
  then refuses. Those few entries can never be fixed, so where AD-4 says the baseline ends empty
  and deleted, they move to the script's counted exceptions with their reason.
- **Subprocesses.** `GSubprocess` or `g_spawn_async` with an argument vector; never a shell command
  built from strings, and the functions that build one are poisoned.

## Testing (chapter 07)

- **GTest under Meson,** with TAP output. `g_test_init` makes warnings and criticals fatal, and
  `g_test_trap_subprocess` tests that a panic does abort.
- **Leaks (TS-3).** LeakSanitizer runs with AddressSanitizer. Creating and destroying one window
  leaks fontconfig's cache (about 20 KB in 690 allocations), and under Xvfb on Debian also Mesa's
  GL state (about 100 KB) unless tests set `GDK_GL=disable`. Past that, one suppression is
  enough: the whole widget suite of the project above passes with `leak:libfontconfig.so` alone.
  Suppress nothing broader: a suppression for GTK or Pango would hide the application's own
  GObject leaks.
- **Fuzz every parser (TS-16).** libFuzzer (`clang -fsanitize=fuzzer,address`) on each function
  that reads outside data is C's property test, and finds the memory errors property tests in safe
  languages cannot have. Each target's seed corpus runs as an ordinary test. theft is a
  property-testing library for C (PROPOSED).
- **Mutation (TS-5).** Plant the bug by hand and watch the check fail; Mull, which mutates through
  LLVM, is not packaged for every distribution (PROPOSED).
- **The interface.** Keep logic out of widgets so most tests need no display. Widget tests run
  under `xvfb-run -a` with `NO_AT_BRIDGE=1` and `GSETTINGS_BACKEND=memory`, and a private
  `dbus-daemon` for anything that needs a session bus, such as GTK's mount dialog. GTK's own
  synthetic events can start a drag but never drive one; XTest can. `desktop-file-validate` checks
  the desktop entry.
- **Interface files (PROPOSED).** `gtk-builder-tool validate` passes a `.ui` file with a bad
  integer or enumeration value, two children in a `GtkBin` or an unknown packing property; a test
  that loads every `.ui` file with `gtk_builder_add_from_file` under `G_DEBUG=fatal-warnings`
  caught ten of eleven deliberately broken files, all but a duplicated property, and validate six.
  `appstreamcli validate` checks the metadata, and compiling `.ui` files and icons into a
  `GResource` removes "the file is missing at runtime" as a failure.

## Data protection (chapter 11)

- **A user's secrets (PROPOSED)** go in the desktop's secret service through libsecret, never in
  a file under `~/.config`, which backups and dotfile repositories copy (DP-1).
- **Logs (DP-3).** `g_warning` reaches the journal and `g_debug` appears when a user sets
  `G_MESSAGES_DEBUG=all`; users paste both into public bug reports, and an abort message goes with
  the core dump. They name kinds and codes, not documents, paths or values: a path holds the user's
  name, and a `GError`'s message often quotes one. A check refuses a path in the application's log
  and abort messages; grep found four on the project above.

## What it does not replace

No flag finds a lifetime error the sanitizers never execute, a race between threads that tests do
not provoke, or an interface that misleads its user. Those stay with fuzzing, review and use.
