#!/usr/bin/env -S bash -p
# -p: this script takes no functions, BASH_ENV or CDPATH from the environment (its children may).
# Fails if the staged change adds a secret-shaped value, or a value tools/secret-hashes.txt lists,
# or stages a path that must never be committed (SH-12). Prints file names and counts only, never
# the matched value. Personal data is not pattern-shaped; the reviewers catch that (DP-1).
#
# Usage: secrets_check.sh              the staged lines (CHECK_BASE and GIT_INDEX_FILE, below)
#        secrets_check.sh --file <f>   a whole file: the commit message, which no diff carries
# In both, the hash list is CHECK_BASE's (HEAD by default, the empty tree before the first commit)
# merged with the tree's, and an allow-list entry counts only when CHECK_BASE's list holds it too.
# Exit: 0 clean, 1 a finding, 2 a usage error, 3 the check itself failed.
set -eEuo pipefail
# Byte-wise matching: in a UTF-8 locale "[^…]" skips a byte that is not UTF-8, hiding a value with one.
export LC_ALL=C
# An exported CDPATH can send `cd` elsewhere and make it print the directory, corrupting the path.
unset CDPATH
trap 'echo "secrets_check.sh: line $LINENO failed; nothing was judged" >&2; exit 3' ERR
here="$(cd -P "$(dirname "$0")" && pwd -P)"
allow="$here/secrets_allow.txt"
whole=""
case "$#:${1:-}" in
  0:) ;;
  2:--file) if [ -f "$2" ]; then whole="$(realpath "$2")"; fi ;;
esac
if [ $# -gt 0 ] && [ -z "$whole" ]; then
  echo "usage: secrets_check.sh [--file <path>]" >&2
  exit 2
fi
cd "$(git rev-parse --show-toplevel)"
scratch="$(git rev-parse --absolute-git-dir)"
status=0
added=$(mktemp -p "$scratch")
patterns=$(mktemp -p "$scratch")
hashlist=$(mktemp -p "$scratch")
allowed=$(mktemp -p "$scratch")
base_allow=$(mktemp -p "$scratch")
names=$(mktemp -p "$scratch")
diffed=$(mktemp -p "$scratch")
prepared=$(mktemp -p "$scratch")
kinds=$(mktemp -p "$scratch")
part=$(mktemp -p "$scratch")
present=$(mktemp -p "$scratch")
trap 'rm -f "$added" "$patterns" "$hashlist" "$allowed" "$base_allow" "$names" "$diffed" \
  "$prepared" "$kinds" "$part" "$present"' EXIT

# Fixed flags: the user's git config (color, prefixes, quoting) must not change what is scanned.
# Added lines are marked ">" (--output-indicator-new), so one whose text starts with "++" is still
# scanned rather than dropped as a file header; no file name is read from a header at all.
# --text and grep -a: one byte that is not UTF-8 makes git print "Binary files differ" and grep
# print "binary file matches", and every line after it would go unscanned.
GIT=(git -c core.quotePath=false --literal-pathspecs)
empty_tree="$(git hash-object -t tree /dev/null)"
# What the lines are added against: HEAD for the hook's staged commit (the empty tree before the
# first one), refs/remotes/origin/main when the gate judges everything a push would carry. The
# index is whichever GIT_INDEX_FILE names.
if [ -n "${CHECK_BASE:-}" ]; then
  BASE="$CHECK_BASE"
elif ! BASE="$(git rev-parse --verify --quiet 'HEAD^{commit}')"; then
  BASE="$empty_tree"
fi
DIFF=(--text --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ --output-indicator-new='>')

forbidden='(^|/)\.env(\..*)?$|(^|/)tokens\.json$|\.pem$|\.key$|^\.cache/'
forbidden+='|(^|/)node_modules/|(^|/)id_(rsa|ecdsa|ed25519)$|\.p12$|\.pfx$'
if [ -n "$whole" ]; then
  # Every line, "#" lines and anything below a scissors line included: git keeps them unless its
  # cleanup mode strips them, and with `-m`, `-F` or `--file` it does not, so a line skipped here
  # could be pushed unscanned. Git's own template comments hold nothing secret-shaped.
  sed -e 's/^/>/' "$whole" >"$added"
  sed -e 's/.*/D/' "$whole" >"$kinds"
else
  # Names NUL-separated, so a name git would quote is judged as it is.
  "${GIT[@]}" diff --cached --name-only -z "$BASE" >"$names"
  found=0
  tr '\0' '\n' <"$names" | grep -aE "$forbidden" | grep -av '\.env\.example$' || found=$?
  if [ "$found" -eq 0 ]; then echo "FORBIDDEN PATH STAGED (listed above)"; status=1; fi
  # Each file diffed alone, named from that list and never from a `+++` header (SH-12), so its
  # added lines are known to be its own. A file is S when it is TypeScript or JavaScript source,
  # where a name in capitals is a constant, and D otherwise; each added line carries its file's
  # letter in $kinds, line for line. A renamed file diffs as wholly added, so all of it is scanned.
  # Deleted files are left out: they add nothing, and a pathspec matches a directory's files too,
  # so a deleted file `x` would pull in the lines of a new `x/...` under its own kind.
  "${GIT[@]}" diff --cached --name-only -z --diff-filter=d "$BASE" >"$present"
  : >"$added"
  : >"$kinds"
  while IFS= read -r -d '' name; do
    # To a file first: piped, a git that failed would read as a diff with no added lines.
    "${GIT[@]}" diff --cached "${DIFF[@]}" -U0 "$BASE" -- "$name" >"$diffed"
    found=0
    grep -a '^>' "$diffed" >"$part" || found=$?
    [ "$found" -le 1 ] || { echo "secrets_check.sh: the staged lines could not be read" >&2; exit 3; }
    cat "$part" >>"$added"
    kind=D
    if [[ "$name" =~ \.([cm]?[jt]s|[jt]sx)$ ]]; then kind=S; fi
    sed -e "s/.*/$kind/" "$part" >>"$kinds"
  done <"$present"
fi
[ "$(grep -ac '' "$added" || true)" = "$(grep -ac '' "$kinds" || true)" ] ||
  { echo "secrets_check.sh: the added lines and their files could not be paired" >&2; exit 3; }

if [ -f .env ]; then
  sed -e 's/\r$//' -e 's/^export[[:space:]]\+//' -e 's/[[:space:]]\+#.*$//' .env |
    sed -n 's/^[A-Za-z_][A-Za-z0-9_]*=//p' | sed "s/^[\"']//; s/[\"']\$//" |
    awk 'length($0) >= 6' >"$patterns"
  if [ -s "$patterns" ] && grep -aF -f "$patterns" "$added" >/dev/null; then
    echo "A .env VALUE APPEARS IN $(grep -acF -f "$patterns" "$added") ADDED LINE(S)"; status=1
  fi
fi

# Token shapes are matched case-sensitively: each is an exact prefix or header, and ignoring case
# turns ordinary prose ("basic …") into findings. Their edges say what may not touch them, a letter
# or digit, rather than where a word ends: `_` is a word character, so `\b` finds no key in
# `KEY_AKIA…`.
check() {
  local label=$1 regex=$2 n
  n=$(grep -acE "$regex" "$added" || true)
  if [ "$n" != "0" ]; then echo "$label: $n added line(s)"; status=1; fi
}
q="[\"']"
check "SSN-shaped value" '(^|[^0-9])[0-9]{3}-[0-9]{2}-[0-9]{4}([^0-9]|$)'
edge='(^|[^0-9A-Za-z])'
end='([^0-9A-Za-z]|$)'
check "AWS access key" "${edge}(AKIA|ASIA)[A-Z0-9]{16}${end}"
check "AWS Bedrock API key" "${edge}ABSK[A-Za-z0-9+/=]{20,}"
check "GitHub token" "${edge}(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})"
check "Slack token" "${edge}xox[abpors]-[A-Za-z0-9-]{10,}"
check "Google API key" "${edge}AIza[A-Za-z0-9_-]{35}${end}"
check "Basic auth header" 'Basic [A-Za-z0-9+/]{16,}={0,2}'
check "private key" 'BEGIN [A-Z ]*PRIVATE KEY-----(\\n|[[:space:]]*$|[A-Za-z0-9+/]{40,})'
# Values in secrets_allow.txt are public by design: the development database passwords compose
# publishes, which production refuses (SV-3). Each is replaced by a five-letter marker before the
# line is tested: short enough to pass the length thresholds alone, so a real secret that merely
# contains an allowed value is still caught. A blank or short entry would match nearly everything,
# so the list is refused instead.
valid_list() { ! grep -avE '^[^[:space:]]{6,}$' "$1" >/dev/null; }
if [ ! -r "$allow" ] || ! valid_list "$allow"; then
  echo "secrets_allow.txt is unreadable, or has an entry that is blank or under 6 characters"
  exit 1
fi
# An entry counts only when the base's list holds it too, so one change cannot list a value and add
# it (SH-12): a new entry counts from the next ship, a removed one at once. Before the first commit
# there is no base to hold it, and the tree's list is the whole of it.
if [ "$(git rev-parse "$BASE^{tree}")" = "$empty_tree" ]; then
  cp "$allow" "$allowed"
else
  "${GIT[@]}" show "$BASE:tools/ship/secrets_allow.txt" >"$base_allow" 2>/dev/null || : >"$base_allow"
  valid_list "$base_allow" || { echo "the base's secrets_allow.txt has an invalid entry"; exit 1; }
  found=0
  if [ -s "$base_allow" ]; then grep -axF -f "$base_allow" "$allow" >"$allowed" || found=$?; fi
  [ "$found" -le 1 ] || { echo "secrets_check.sh: the allow lists could not be compared" >&2; exit 3; }
fi
# A literal starts with anything but a quote, a space, "<", "$" or "(", and runs to a quote, a
# space, "," ";" or the line end; one that runs into "(" is a call, not a value.
value="[^\"' <\$(][^\"'[:space:](]{7,}($q|[[:space:]]|,|;|\$)"
# A shell default such as ${POSTGRES_PASSWORD:-value} is reduced to its value, which is then tested
# like any other (an allowed one becomes the marker); a bare ${NAME} or ${NAME:?message} names no
# value and is dropped. Written to a file once, so a failure stops the check rather than reading as
# no matches.
sed -E -e 's/\$\{[A-Za-z_][A-Za-z0-9_]*:?[-=]([^}]*)\}/\1/g' \
  -e 's/\$\{[A-Za-z_][A-Za-z0-9_]*(:?[?+][^}]*)?\}//g' "$added" >"$diffed"
awk -v list="$allowed" '
  BEGIN { while ((getline entry < list) > 0) allowed[entry] = 1 }
  {
    line = $0
    for (entry in allowed)
      while ((i = index(line, entry)) > 0)
        line = substr(line, 1, i - 1) "ALLOW" substr(line, i + length(entry))
    print line
  }' "$diffed" >"$prepared"
# Each match of a pattern in the lines of $part, one per line, into $diffed.
matches() {
  local found=0
  grep -aoE "$@" "$part" >"$diffed" || found=$?
  [ "$found" -le 1 ] || { echo "secrets_check.sh: a pattern could not be run" >&2; exit 3; }
}
# Drops the matches the pattern describes, which name a value rather than being one.
drop() {
  local found=0
  grep -avE "$1" "$diffed" >"$names" || found=$?
  [ "$found" -le 1 ] || { echo "secrets_check.sh: a pattern could not be run" >&2; exit 3; }
  cp "$names" "$diffed"
}
# Each match is judged on its own, so a reference later on a line cannot hide a literal earlier on
# it. An unquoted value rooted in a known configuration object names a value rather than being one,
# as do a TypeScript type annotation (`password: string`) and a psql variable
# (`password :'owner_password'`: a space before the colon, a quoted identifier). In TypeScript and
# JavaScript source only, so does a name in capitals that `;`, `,`, `)` or `}` ends, whatever code
# follows (`= ROLE_PASSWORD;`, or a default parameter's `= PASSPHRASE): Promise`). A match runs to
# the next space, so after a name's terminators comes a colon, a space or the match's end;
# anything else continues a literal that holds a brace or a parenthesis (`= AB}k8sXq29zz`). In any
# other file, YAML, .env and JSON among them, a value in capitals is a literal, whatever ends it.
key="(password|passwd|secret)$q?[[:space:]]*[:=][[:space:]]*"
roots="(config|cfg|env|process|this|opts|options|settings|ctx)"
# The match ignores case, so the key does here too (`ownerPassword: config.x`); the value part
# keeps its case, since a constant's name is told from a literal by its capitals.
ikey="([Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Pp][Aa][Ss][Ss][Ww][Dd]|[Ss][Ee][Cc][Rr][Ee][Tt])"
ikey="$ikey$q?[[:space:]]*[:=][[:space:]]*"
literals=0
for kind in S D; do
  # The prepared lines of one kind of file (S source, D any other), paired by line.
  paste -d '' "$kinds" "$prepared" | { grep -a "^$kind" || true; } | cut -c2- >"$part"
  matches -i "$key$q?$value"
  drop "$ikey$roots(\.[A-Za-z_\$][A-Za-z0-9_\$]*)+"
  drop "$ikey(string|number|boolean)([^A-Za-z0-9_]|\$)"
  if [ "$kind" = S ]; then drop "$ikey[A-Z][A-Z0-9_]*[;,)}]+(:|[[:space:]]|\$)"; fi
  drop "^(password|passwd|secret)[[:space:]]+:('[A-Za-z_][A-Za-z0-9_]*'|\"[A-Za-z_][A-Za-z0-9_]*\")\$"
  literals=$((literals + $(grep -ac '' "$diffed" || true)))
done
if [ "$literals" != "0" ]; then echo "password literal: $literals match(es)"; status=1; fi
# The patterns below judge every file alike.
cp "$prepared" "$part"
# The user part may be empty and the password may hold "/" or "$". A password starting with "$" and
# a name, "{" or "(" is a variable or substitution; one that is digits then "/" is a port and path.
matches '://[^/:@[:space:]"]*:[^@[:space:]"]{6,}@'
drop '^://[^/:@[:space:]"]*:(\$[A-Za-z_{(]|[0-9]+/)'
urls=$(grep -ac '' "$diffed" || true)
if [ "$urls" != "0" ]; then echo "password in a URL: $urls match(es)"; status=1; fi

# A value with no shape is known only by its digest. The list is the base's as well as the tree's,
# so one change cannot drop a digest and add its value. Node runs in Docker on the workstation, so
# the lookup runs only once a list holds a digest; a run that cannot start fails the check rather
# than passing it. The list and the lines travel on stdin, split by a NUL.
hashes=tools/secret-hashes.txt
{
  if [ -f "$hashes" ]; then cat "$hashes"; fi
  "${GIT[@]}" show "$BASE:$hashes" 2>/dev/null || true
} >"$hashlist"
if grep -aiE '[0-9a-f]{64}' "$hashlist" >/dev/null; then
  looked=0
  { cat "$hashlist"; printf '\0'; cat "$added"; } |
    env -u GIT_INDEX_FILE "$here/run-node" tools/ship/check-secret-hashes.ts || looked=$?
  case "$looked" in
    0) ;;
    3) echo "the known-secret check found a listed value"; status=1 ;;
    *) echo "the known-secret check could not run (exit $looked)"; status=1 ;;
  esac
fi

if [ "$status" -eq 0 ]; then echo "secrets check: clean"; fi
exit "$status"
