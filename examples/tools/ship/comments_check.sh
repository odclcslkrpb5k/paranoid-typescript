#!/usr/bin/env -S bash -p
# -p: this script takes no functions, BASH_ENV or CDPATH from the environment (its children may).
# Refuses an added comment that narrates a change (CD-1): check-comments.ts over the lines added
# against CHECK_BASE (HEAD by default: the hook's staged commit; the empty tree before the first
# one) in whichever index GIT_INDEX_FILE names. Node runs in Docker on the workstation, so git runs
# on this side and hands each file over on stdin as `name NUL diff NUL`; names come NUL-separated
# from git and each file is diffed alone, as a literal pathspec (SH-12).
# Exit: 0 clean, 1 a finding, 3 the check itself failed.
set -eEuo pipefail
unset CDPATH
export LC_ALL=C
trap 'echo "comments_check.sh: line $LINENO failed; nothing was judged" >&2; exit 3' ERR
here="$(cd -P "$(dirname "$0")" && pwd -P)"
cd "$(git rev-parse --show-toplevel)"
if [ -n "${CHECK_BASE:-}" ]; then
  base="$CHECK_BASE"
elif ! base="$(git rev-parse --verify --quiet 'HEAD^{commit}')"; then
  base="$(git hash-object -t tree /dev/null)"
fi

scratch="$(git rev-parse --absolute-git-dir)"
names="$(mktemp -p "$scratch")"
payload="$(mktemp -p "$scratch")"
trap 'rm -f "$names" "$payload"' EXIT
GIT=(git -c core.quotePath=false --literal-pathspecs)
"${GIT[@]}" diff --cached --name-only -z --diff-filter=ACMR "$base" >"$names"
# Written whole before the checker starts, so a git that fails stops this script rather than handing
# the checker a short input to pass. vendor/ is skipped by the checker, which says why.
while IFS= read -r -d '' name; do
  printf '%s\0' "$name"
  "${GIT[@]}" diff --cached -U0 --text --no-color --no-ext-diff "$base" -- "$name"
  printf '\0'
done <"$names" >"$payload"

judged=0
env -u GIT_INDEX_FILE "$here/run-node" tools/ship/check-comments.ts <"$payload" || judged=$?
case "$judged" in
  0) ;;
  3) exit 1 ;;
  *) echo "comments_check.sh: the comment checker could not run (exit $judged)" >&2; exit 3 ;;
esac
