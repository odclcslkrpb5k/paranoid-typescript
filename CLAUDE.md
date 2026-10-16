# Working on the standard

This repository is the Paranoid TypeScript standard itself: prose, not code. These rules keep it
coherent and trustworthy.

- **Judge every rule by the Hierarchy of Defect Controls.** Name its rung. Weigh a proposed rule
  against a control on a higher rung that would make it unnecessary, and for an Administer rule,
  name the Engineer control that is missing.
- **A rule earns its place with a reason.** Every rule has `Why` and `Enforced by`. "It seemed
  cleaner" is not a reason; "this broke, here is how" is. A rule no project has proven yet is
  marked `(PROPOSED)`.
- **Say where a rule comes from.** When a rule matches or descends from an existing standard,
  paper or tool, its `Prior art` line says so plainly.
- **Keep it generic.** No names of private projects, organizations or people, and no internal
  identifiers. Describe the incident behind a rule, not where it happened.
- **IDs are permanent.** Never renumber, reuse or delete one; a rule that stops applying is marked
  `(RETIRED yyyy-mm-dd: reason)` and stays. Take a new ID from the highest in use in its prefix.
- **Weakening or removing a MUST needs the maintainer's explicit agreement.** Adding a rule,
  tightening wording or adding an Engineer control does not.
- **One subject per commit**, and the commit body says what happened that makes the change right.
  Git history is the standard's changelog.
- **Appendices carry the core into another language; they add no rules.** Every line cites the
  core rule it serves, a tool setting is checked against a named version before it is written, and
  what the core already says is linked, not restated. A lesson that holds in every language
  belongs in the core, not in an appendix.
- Lines stay under 100 characters (Markdown table rows and lone URLs exempt).
- Enable the checks once per clone: `git config core.hooksPath .githooks`. The pre-commit hook
  refuses long lines, duplicated or deleted rule IDs, and references to IDs no chapter defines.
