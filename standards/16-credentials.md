# 16 Credentials

How a service proves who it is to the systems it calls, and how that never lapses.

### CR-1 (MUST) Where the other system supports it, a service proves who it is with a key that never leaves its host, not a bearer token a person carries.
The release generates the key on the host (for example `openssl genpkey -algorithm ed25519`), owned
by the service's user and mounted read-only. Only the public half is enrolled with the system being
called. Each request carries a short-lived assertion signed with the key. Nothing expires on a
calendar.

**Why:** a token renewed by a person is an outage on the day someone forgets, and every hand that
carries it is a leak. A key that never leaves the host eliminates both.

**Enforced by:** Eliminate, where the other system supports it. CR-5 where it does not.

### CR-2 (MUST) Switch a running service to a new credential without a gap.
Enroll the new one while the old still works; check the new one from inside the new image before
switching; revoke the old only once it has gone unused while the new one is in use.

**Why:** revoking on the new credential's first use cuts off a release that then rolls back.

**Enforced by:** Administer; the release's check from inside the image is Engineer.

### CR-3 (MUST) A credential failure is reported as one, never as "service unavailable".
Distinguish an unreadable key (a mount or ownership problem), a refused key (an enrollment problem)
and an unreachable service. Exit at startup on the first two; carry on through the third.

**Enforced by:** Engineer — distinct error kinds in the client (RP-5), with tests.

### CR-4 (MUST) Grant the least: read scope where reading is enough, and exactly the routes the code calls.
The consuming repository's README lists the routes; its code is the evidence.

**Enforced by:** Administer.

### CR-5 (MUST) Until a credential can be a key, write down when it expires and how to renew it.

**Why:** an expiry nobody wrote down is an outage with no warning.

**Enforced by:** Administer. Missing Engineer control: the service reports its credentials' expiry
as an alert (SV-11) weeks ahead.

### CR-6 (MUST) A service that verifies signed assertions does it on its own terms, not the assertion's.
- The algorithm comes from the enrolled key's record, never from the assertion's header.
- The service caps the lifetime (`exp - iat`) whatever the client asked for, and allows only a
  small clock skew (a minute at most), so a host with a drifting clock is refused (DE-11).
- A cached grant never outlives the assertion it was granted for.
- A clock fault answers its own code, carrying the server's time, and is never cached.
- The account's state is revealed only after the signature is verified.
- Verification uses a vetted library (such as `jose`), not hand-written parsing.

**Why:** each is a way to turn a five-minute credential back into a long-lived one, or to tell a
stranger something about an account. A cached clock refusal kept refusing after the clock came
right.

**Enforced by:** Engineer — the verifier and its tests.

**Prior art:** the JWT "alg" confusion attacks (and RFC 8725, JWT Best Current Practices).

### CR-7 (MUST) Access for an outside party is granted by a person, one key at a time.
The party sends its public key and fingerprint; the fingerprint is read back to them on a second
channel before the key is enrolled; the account is granted only the routes agreed. No endpoint
enrolls or rotates a key by itself for an outside party.

**Why:** a public key is not secret, but it has to be theirs: one swapped in transit would be
enrolled as them.

**Enforced by:** Administer.
