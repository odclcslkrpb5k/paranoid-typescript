# The ship tool

A reference implementation of chapter 10: scripts that commit and push only the tree the checks
passed against (SH-10), stop at the first failing step (SH-11), scan what is pushed for secrets
(SH-12), require the further steps a change's paths call for (SH-13), refuse a file the change
did not mean to add (SH-15), and run as strict, isolated bash (SH-14). It also holds the mutation
runner of TS-5 and the comment check of CD-1.

It comes from the ship tools of several projects that adopted the standard, merged and hardened
under review; the tests in [`test/ship/`](../../test/ship/) pin each guarantee. It is written for a
project at the root of its own repository, whose workstation has Docker and no Node (TC-9). Here it
lives inside the examples, whose tests run it in throwaway repositories.

## A ship

    tools/ship/timed --start                    a new ledger for this ship
    tools/ship/steps                            the gate, the suite, then each required step
    tools/ship/commit-and-push <tree> <message-file> [--reviewed <tree>]
    tools/ship/close-ship --nothing | --sent "<the candidates>"     the SH-9 decision
    tools/ship/timed --report                   what each step cost

`steps` runs every step under `timed`, which records the step's exit status and the tree it ran
against, at its start and at its end, in a ledger under `.git/` (so it can never be committed).
`commit-and-push` then commits `<tree>` only if the latest run of each required step passed against
exactly that tree from start to finish, and pushes that commit by hash to the one push URL fixed
before the commit. `timed --report` waits until the ship's SH-9 decision is recorded.

| Script                                                           | Does                                                                        | Rules               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------- |
| [`timed`](timed)                                                 | runs one step, records its status, its tree and its cost; reads its output  | SH-7, SH-10, SH-11  |
| [`steps`](steps)                                                 | the gate, then the suite, then each required step, stopping at the first    | SH-11, SH-13        |
| [`gate`](gate)                                                   | the hook's checks over everything since origin's main; no ignored file read | SH-10, SH-12, CD-1  |
| [`commit-and-push`](commit-and-push)                             | commits and pushes the checked tree, or nothing                             | SH-10, SH-12, SH-15 |
| [`close-ship`](close-ship)                                       | records what the ship could teach the standard                              | SH-9                |
| [`tree-hash`](tree-hash), [`ship-diff`](ship-diff)               | the tree, and the diff, of exactly what `git add -A` would commit           | SH-10               |
| [`required`](required), [`required-steps`](required-steps)       | the further steps a change's paths call for, read from origin and the tree  | SH-13               |
| [`command-form`](command-form)                                   | a command in the one form the ledger records and compares                   | SH-13               |
| [`allowed-paths`](allowed-paths)                                 | the paths a ship may add                                                    | SH-15               |
| [`secrets_check.sh`](secrets_check.sh), `check-secret-hashes.ts` | secret shapes, known secret digests and forbidden paths in added lines      | SH-12               |
| [`comments_check.sh`](comments_check.sh), `check-comments.ts`    | added comments that narrate a change                                        | CD-1                |
| [`mutate`](mutate), [`mutants`](mutants)                         | one mutant at a time, judged by a failing test and its reason; the record   | TS-5                |
| [`run-node`](run-node)                                           | the TypeScript checks' node, in the project's image with no network         | TC-9                |
| [`../../.githooks/`](../../.githooks/)                           | the secrets and comment checks on each commit, and on its message           | SH-12, CD-1         |

## Adopting it

Copy `tools/ship/`, `tools/secret-hashes.txt`, `.githooks/` and `test/ship/` to the same paths in
the project, enable the hooks (`git config core.hooksPath .githooks`; `commit-and-push` refuses
without them), and set what is the project's own:

- the image `run-node` starts (`app:dev`), whose working directory is `/repo` and which holds the
  project's `node_modules` there;
- the suite's command, `docker compose run --build --rm check`, written in `steps`, in
  `commit-and-push` and in `test/ship/scratch.ts`;
- `allowed-paths` and `required-steps`, for the project's layout and its rehearsals;
- `secrets_allow.txt`, the published development passwords, if any, which production refuses
  (SV-3); and `tools/secret-hashes.txt`, the digests of secrets with no shape. Both are read from
  origin's main as well as the tree, so one change cannot list a value and add it.

The suite runs `test/ship/` with `SHIP_NODE=node`, since the check container has Node and no
Docker. In these examples that is `docker compose run --build --rm -e SHIP_NODE=node check`.

## Mutation testing

    tools/ship/mutate <file> <find> <replace> <reason> -- <command...>

puts one mutant in a file, runs the command, and restores the file from its own copy, never from
git. It refuses a mutant that does not compile, a command that fails without the mutant, a run in
which no test failed, and a `<reason>` that any failing log would meet; a mutant is killed only
when a test fails and the failure lines, not the runner's summary, match `<reason>`. Each verdict
is recorded under `.git/ship-mutants/`, and `tools/ship/mutants` lists what is due: a survivor
never answered, an equivalence whose files have changed, a survivor whose code has gone.

## Known limits

- `.dockerignore` must hold plain names: the gate cannot read a pattern, so it fails on one rather
  than excusing anything.
- The comment check catches a fixed set of phrases about the code's history; it cannot judge a
  comment that will stop being true. That re-read stays with review.
- `mutate` type-checks TypeScript with `tsc` over `tsconfig.json`'s program, so a file outside that
  program cannot be mutated; files of other kinds (SQL, JSON) are judged by the command alone.
