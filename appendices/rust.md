# Appendix: Paranoid Rust

How the core standard carries into Rust. Like every appendix it defines no rules of its own: each
item names the core rule it serves and says what meets it in Rust, where Rust leaves a gap, and
where a tool falls short of its documentation. A core rule not mentioned here applies as written,
wherever it applies.

Rust brings much of the core's chapter 04 and 05 as the language: `Result` and `panic!` are the
model ER-1 and ER-2 describe, an exhaustive `match` is LN-3 without a lint, `#[must_use]` is LN-6,
and a newtype is a brand (BD-5). What the language does not settle is what a panic costs. One
hazard comes first for that reason, judged on the ladder like a rule.

**Status.** Drawn from one project as it adopts the controls: a desktop daemon that parses
clipboard data from local applications and messages from the network, with a GTK user interface in
a separate process. It plants a bug against each control and asserts the gate fails at that
control's step, for the reason the control gives. Each setting below was checked on 2026-10-23
against rustc 1.99.1, clippy 0.1.99, cargo-deny 0.20.2, cargo-mutants 27.1.0 and cargo-fuzz 0.13.2
on nightly-2026-10-15. Not yet measured, and so not yet written: the panic strategy (`unwind` or
`abort`) and what it contains, and `overflow-checks` in a release build. Read every item as
(PROPOSED) until that project has run it for a while. Tool options change between versions; check
each against the version you install.

## Panics: a hazard the core never meets

Safe Rust turns an out-of-bounds read into a panic. That eliminates corruption and disclosure, but
not the defect: in a service that parses what strangers send, a panic it does not contain is a
denial of service anyone can trigger. CVE-2026-41476 shows the shape. In Deskflow, a C++ keyboard
and clipboard sharing tool, the clipboard's chunk assembly checked only the outer transfer size, so
malformed inner lengths reached the decoder, which read past its buffer and disclosed memory. The
same decoder in safe Rust panics instead. In ladder order:

- **Eliminate** memory unsafety: `unsafe_code = "forbid"` in every crate but a named adapter for
  foreign code (ER-3). See [Unsafe code](#unsafe-code-chapter-03).
- **Engineer** a decoder that cannot panic. Deny the restriction lints at the top of each crate
  that decodes untrusted bytes:

        #![deny(
            clippy::indexing_slicing,
            clippy::arithmetic_side_effects,
            clippy::unwrap_used,
            clippy::expect_used,
            clippy::panic,
            clippy::string_slice,
            clippy::unreachable,
            clippy::todo,
            clippy::unimplemented
        )]

  The attribute goes in the crate's source because a crate that takes its lints from the workspace
  (`[lints] workspace = true`) cannot add its own in its manifest. A 250-line frame and payload
  decoder met them with no suppressions. They forced one bounds-checked reader that every read goes
  through (`split_at_checked`), slices turned into arrays by `try_into`, lengths kept in their wire
  types from construction so the encoder never narrows, `saturating_add` in size sums and
  `checked_add` for a frame's length. Check an inner length against what remains to read, never
  only against the outer total (BD-1).
- **Plant against them with care (TS-5).** `arithmetic_side_effects` knows ranges: on clippy
  0.1.99, `usize::from(n) + 1` with `n: u8` is not flagged, since it cannot overflow, while
  `usize::from(n) + p.len()` is. A plant for it needs two unbounded operands; the first one tried
  used the bounded form and was caught only by a test, as a logic bug.

## Toolchain (chapter 01)

- **Frozen install (TC-3).** Every cargo command in the gate passes `--locked`. A manifest's
  version requirement changed without the lockfile fails the first such command, on cargo 1.99.1
  with "cannot update the lock file ... because --locked was passed to prevent this" (exit 101).
- **cargo-deny does not check what it does not list (TS-6).** cargo-deny 0.20.2 leaves out every
  dev-dependency from outside the workspace when it builds its graph, and neither `--workspace` nor
  `[graph] exclude-dev = false` changes that. With `[licenses] allow = ["Apache-2.0", "MIT"]`, a
  dev-dependency licensed MPL-2.0 passed `cargo deny --locked check licenses` (exit 0), and
  `cargo deny list` named only the workspace's own crates while `cargo tree` showed the
  dev-dependency. The only sign was a `license-not-encountered` warning for each allowed licence.
  The advisory check is not affected: it failed on RUSTSEC-2020-0071 in `time` 0.1.45 held as a
  dev-dependency (exit 1). Run the licence check on a copy of the manifests in which
  `[dev-dependencies]` is renamed `[target.'cfg(all())'.dependencies]` (that copy then failed with
  `error[rejected]`, exit 4), and have the gate compare deny's set of `name@version` with the set
  from `cargo tree --workspace --locked --edges normal,build,dev`, for the build's target. Compare
  sets, not counts: `Cargo.lock` also lists dependencies of other platforms.

## Unsafe code (chapter 03)

- **Workspace lints reach only the crates that ask (LN-1, ER-3).**
  `[workspace.lints.rust] unsafe_code = "forbid"` applies to a member only when its own manifest
  says `[lints]` with `workspace = true`. On clippy 0.1.99, a member without it compiled an
  `unsafe fn` and an `unsafe` block under `-D warnings` with exit 0; with it, both were refused.
  The gate refuses any member manifest without the opt-in, since nothing in cargo does.
- **Plant necessary unsafe (TS-5).** An empty `unsafe {}` fails under `-D warnings` through
  `unused_unsafe` whether or not `forbid` reaches the crate, so it proves nothing. Plant an
  `unsafe` call to an `unsafe fn` instead.

## Testing (chapter 07)

- **Fuzz every decoder (TS-16).** Keep the fuzz crate (cargo-fuzz, on a pinned nightly) outside the
  workspace with a lockfile of its own, and hold it to the same frozen install and dependency
  checks as the rest (TC-3): fetch with `cargo fetch --locked` before `cargo fuzz run`, which
  otherwise resolves the lockfile again, and run cargo-deny over its manifest too. The target
  asserts more than "no panic": what the decoder reports as incomplete really is short, and a
  decoded frame encodes back to exactly the bytes it consumed. Two libFuzzer options can quietly
  make the run weaker than it looks:
  - `-max_len` must reach past the largest limit the decoder enforces, or no input ever tests that
    limit.
  - `-max_total_time=0` means no limit: on nightly-2026-10-15 a run given it was still going when
    `timeout` stopped it at 25 seconds, while `-max_total_time=3` ended in about four. A script
    that takes the time as a setting refuses 0.

  Planted against a copy of the decoder with its lints removed, an inner length trusted the way
  CVE-2026-41476's was (`payload[start..start + len]`) was found in under 2.1 seconds from an empty
  corpus in each of three runs, and while the saved corpus loaded. Replay the corpus as an ordinary
  test on the stable toolchain, and assert how many inputs it decoded, not how many files it read
  (TS-6): in that project only 3 of 42 decoded to a message.
- **cargo-mutants reports a hang as its own outcome, and its exit status hides a miss (TS-5).** A
  mutant that never ends is `TIMEOUT` under `--timeout`, listed in `mutants.out/timeout.txt`, not
  counted as caught. On cargo-mutants 27.1.0 the exit status was 2 with missed mutants only, 3 with
  timeouts only, and 3 with both, so a gate reads `missed.txt` and `timeout.txt` rather than the
  status. In a debug build an overflow panics, so a mutant turning `+=` into `-=` was caught by
  `overflow-checks` rather than by an assertion. On the project's decoder the first run missed 17
  of 71 mutants. Property tests that compared whole values never called a getter. Two methods were
  never used and were deleted. Neither size limit was tested at its boundary. `Display` was never
  checked.
- **A copy of the tree builds into its own target directory (TS-8).** Set `CARGO_TARGET_DIR` inside
  the tree from the gate, never in the image: cargo-mutants and a plant runner copy the tree, and a
  shared directory let one copy's test binary run for another.

## What it does not replace

The lints refuse a panic a decoder could reach, and fuzzing looks for the inputs that reach one
the lints were not there to refuse; neither shows that the decoder decodes correctly, or that its
size limits hold before it allocates. Those stay with property tests (TS-16), mutation testing
(TS-5), and review.
