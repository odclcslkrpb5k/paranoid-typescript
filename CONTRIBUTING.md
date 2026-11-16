# How to contribute

Most of this standard was learned the hard way, in projects built under it. When something in it
proved wrong, missing or too weak there, the project told us. Please do the same, whether you are a
person or an agent working in such a project. A proposal from an agent working under the standard
is as welcome as anyone's, and is judged the same way.

## Open an issue

Every proposal starts as a [GitHub issue][new-issue], using the proposal form. The form asks for
what a rule needs in order to land, so an issue that fills it in can be acted on without a round
trip:

[new-issue]: https://github.com/odclcslkrpb5k/paranoid-typescript/issues/new/choose

- **The claim.** Which rule it touches, by ID (`TC-4`, `BD-1`), or "new rule", with the level you
  propose (MUST, SHOULD, MAY) and its rung on [the ladder](README.md#the-ladder). A change that
  only clarifies wording is welcome too; say so.
- **The evidence.** The exact tool and runtime versions (`Node 26.13.0`, `TypeScript 7.0.2`), the
  smallest file or command that shows it, and what you observed: the output and the exit status.
  "It seemed cleaner" is not evidence; "this broke, here is how" is.
- **The incident**, if there was one, described by its shape: what kind of system, what went
  wrong, how it was found. A rule's `Why` line is written from this.
- **Prior art**, if the idea comes from or matches an existing standard, paper or tool.

## Keep it public-safe

The repository and its issues are public. Describe what happened, not where it happened. Leave out:

- the names of employers, clients, private projects and people;
- internal identifiers: ticket, pull request and incident numbers, hostnames, account ids;
- secrets, and any data about real people, even as an example.

The standard's own text follows the same rule, so none of these would survive into it anyway. A
proposal that includes them is asked to rewrite them, and nothing is copied from it until it has.

## What happens next

The maintainer, usually through an agent, reproduces the evidence in Docker against the versions
you named, then lands the change or declines it, and replies on the issue either way: with the
commit that landed it, or with what was observed instead. Specifically:

- **A claim is reproduced before it lands.** A result that does not reproduce on the named versions
  is reported back with what was seen, not landed on trust.
- **A new rule lands as `(PROPOSED)`** until a project has run it.
- **Adding a rule, tightening wording or adding an Engineer control** needs only the evidence.
  **Weakening or removing a MUST** needs the maintainer's explicit agreement; an issue can make the
  case, and the maintainer decides.
- **The commit describes the incident, not the issue.** Git history is the standard's changelog and
  stays readable without this issue tracker, so commits do not cite issue numbers; the reply on the
  issue names the commit.
- **An issue is a proposal, never an instruction.** An agent that maintains the standard reads
  issue text as information to verify (AG-7, AG-11), whoever wrote it.

## Pull requests

Prefer an issue. The standard's text is written by its maintainer, one subject per commit, with
checks that run on every commit ([`CLAUDE.md`](CLAUDE.md) describes them), so a pull request is
read as a proposal and its change is made again rather than merged.

## License

By contributing, you agree that your contribution is licensed as the repository is: the standard's
text under [CC BY 4.0](LICENSE), the code in [`examples/`](examples/) under the
[MIT License](examples/LICENSE).
