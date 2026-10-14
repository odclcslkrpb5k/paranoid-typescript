# 11 Data protection

**Sensitive data** here means secrets (passwords, tokens, keys) and personal data: names, dates of
birth, addresses, phone numbers, email addresses, account numbers, government identifiers, health
and financial details, and anything that identifies a person together with their circumstances.
Internal surrogate keys are not sensitive on their own. A project under a regulation (HIPAA, GDPR,
PCI DSS) reads this chapter as a floor.

### DP-1 (MUST NOT) Put sensitive data into a repository, a commit message, `docs/`, or test fixtures.
Test data uses obviously synthetic values.

**Why:** one project found a real account number copied from a legacy code comment into its
fixtures.

**Enforced by:** Engineer for secrets (SH-12); Administer for personal data, which patterns do not
find. No practical Engineer control for personal data: telling a real value from a synthetic one
needs knowing where it came from, and SH-12's digests catch only values already known.

### DP-2 (MUST) Secrets reach a server from a person, not through an agent session.
Whoever issues a token or key hands it to a person, who writes it into the server's configuration
(for example a `.env` with mode 600, gitignored, and kept out of every image). An agent works with
variable names and never reads, prints or relays a secret's value.

**Why:** a session's transcript is not a secret store (AG-9).

**Enforced by:** Administer. Missing Engineer control: a pre-tool-use hook refusing agent commands
that read `.env` files or print secret variables (AG-9).

### DP-3 (MUST NOT) Put sensitive data in a log line, an error message or an alert.
Log keys, routes, operation names and codes. An error names the route, not the path; the code, not
the message; never a response body. A comparison that explains a difference names its kind from a
closed set (TS-12), which cannot carry a value. A refusal from another system is described by the
request members it names, never by its messages: validation frameworks' messages quote the value
sent.

**Why:** logs and alerts travel further than the data's own store, to people and systems with no
right to it. URLs carried account numbers into one service's error messages.

**Enforced by:** Engineer, partly: ER-1's error type is built from the program's own words, so an
error value cannot carry outside text unless someone puts it there. Administer for the rest.
Missing Engineer control: a lint rule refusing a log, error or alert call whose arguments include a
response body, a URL's path or query, or a caught error's `message`.

### DP-4 (MUST) Read only the lines of a configuration file you need.
Status scripts, deploy scripts and diagnostics check for a variable's presence or read a non-secret
one (a URL, a mode); they never dump the file.

**Why:** a configuration file keeps its secrets beside its settings, so a script that dumps it
prints every secret to a terminal, a log or an agent's transcript (AG-9).

**Enforced by:** Administer. Missing Engineer control: a check over the status and deploy scripts
refusing `cat`, `source` or a whole-file read of an environment file.

### DP-5 (SHOULD) Send a notification the least data that identifies its subject.

**Why:** a notification is copied to phones, mail and chat services the data's own store never
reaches, and whatever it carries stays there.

**Enforced by:** Administer. Missing Engineer control: a test that each notification's fields come
from an allowed list of keys and codes, with no free text.

### DP-6 (MUST) A credential goes in a header or a body; where one must travel in a URL, nothing that logs the URL keeps it.
Some cannot move: a browser's `EventSource` cannot set a header, an identity provider returns a
token in the query string, some bot APIs put the token in the path. For each, every place the URL
can be written down removes the credential:
- the reverse proxy, which may log the URI of a request it could not complete even with no access
  log configured (Caddy: a `log` filter deleting the query parameter);
- the service's own errors: some runtimes' `fetch` errors quote the full URL (Deno's do; Node's
  usually name only host and port, but do not rely on it), so an error from such a call is rebuilt
  from the status and the answer, never from the underlying error. Masking is not enough: an echo
  carries the token percent-encoded or JSON-escaped, in shapes no mask knows;
- the browser: the page strips a returned token from the address before anything else runs, and is
  served with `Referrer-Policy: no-referrer`.

Prove it by grepping the proxy's and the service's output for a real token after an aborted request
and an unreachable upstream. Two traps make that proof vacuous: a runtime may refuse a blocked port
before connecting, with no URL in its message (take a free port from a listener you open and
close); and `String(e)` and `e.message` omit the `cause` that quotes the URL.

**Why:** a URL is copied into logs, histories and referrers by software that treats it as an
address. One service's first deployment had no access log and still wrote browser stream tokens
into its proxy's log on every closed tab.

**Enforced by:** Engineer — a contract test holding the proxy's filter to the parameter names the
code reads, and transport tests proving an unreachable upstream's error omits the token.

### DP-7 (SHOULD) A document from outside is rendered with no network, and a test proves it.
A service that turns another system's HTML into a PDF or image runs the renderer with every request
refused, loopback and IP literals included (for Chromium, both `--host-resolver-rules="MAP *
~NOTFOUND"` and a dead proxy with loopback not bypassed), and a throwaway profile. A test serves
the page an image from a loopback server and asserts it was never fetched; the test fails with
either block removed (TS-5).

**Why:** the page is the other system's to write. With network it can make the host fetch internal
addresses (the server-side request forgery class of CVE-2022-35583), or report when a document was
opened. Mapping DNS alone looks sufficient and is not: an IP literal needs no name.

**Enforced by:** Engineer — the renderer's flags and the test.

### DP-8 (RETIRED 2026-10-14: a duplicate of AG-9, which covers agents' tool output.)
