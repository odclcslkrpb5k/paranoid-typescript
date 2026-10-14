# 15 Deployment

This chapter describes **one way** of deploying a service: a container image built on a workstation
from a committed tree, shipped over SSH to a Linux host you run, and started with Docker Compose,
with HTTPS terminated by one proxy per host. It has run several production services and works well.
It is not a requirement. A project on a platform (a PaaS, Kubernetes, serverless) skips the
commands and keeps the principles, which are the parts most rules here exist to protect:

- an image is exactly the commit it is labelled with;
- configuration is validated before the running service is touched;
- a release watches what it started and undoes itself if it does not stay up;
- the deploy script's failure paths are rehearsed before they are needed;
- the process runs with the least privilege it needs.

## Releases

### DE-1 (SHOULD) Build the image from the committed tree, and tag it with the commit.
`git archive HEAD | docker build -`, tagged `<service>:<12-character commit>`, with the commit
passed as a build argument so the running service can report its revision. Ship it with `docker
save | gzip | ssh <host> docker load`, or push it to a registry and deploy by digest. A release
refuses uncommitted changes. Building on the server is acceptable where the image is very large and
the server's layer cache makes a rebuild cheap; it still builds only a committed revision.

**Why:** an image built from the working tree can contain what no commit does, and the server needs
only Docker.

**Enforced by:** Engineer — the release script refuses a dirty tree; `git archive` cannot see an
uncommitted file.

### DE-2 (SHOULD) Each service lives in one directory on the host, with its compose file and its environment file.
`/opt/<service>/compose.yaml` (installed by the release from the repository's production compose
file) and `/opt/<service>/.env` (the operator's, mode 600, DP-2). The release records the image tag
in the `.env` and edits only the lines it owns.

**Enforced by:** Administer.

### DE-3 (MUST) The production compose file sets restart, grace, log rotation and refuses to pull.
- `restart: unless-stopped`.
- `stop_grace_period` longer than the longest unit of work (SV-4), counting a client's retries:
  attempts times the per-attempt deadline, plus backoff. A client with 120-second deadlines and
  three tries outlasted a four-minute grace.
- Log rotation, either per service or once for the host (`{ "log-driver": "local" }` in
  `/etc/docker/daemon.json`, before the first container is created, so a compose file cannot forget
  it), sized to how long logs must be readable, not only to the disk.
- `pull_policy: never` on each service (or every `up` with `--pull never`), so a missing image
  fails rather than being looked up on a public registry.
- Bind mounts that must exist use the long syntax with `create_host_path: false`, so a missing file
  fails rather than becoming a root-owned directory.

**Why:** Docker's default ten-second grace kills work halfway; its default log driver never
rotates, and a container that runs for months fills the disk. Rotation at 10 MB × 3 kept about a
day of logs, and the first full day of a shadow comparison was gone before anyone read it.

**Enforced by:** Engineer — a contract test over the production compose file (which can see
`pull_policy` but not a command-line flag); TS-7 for the grace period against the client's retry
settings; for a host-wide log driver, the host bootstrap's check of `daemon.json` (DE-11).

### DE-4 (MUST) A release checks the server first, validates configuration before touching the running service, watches the new container, and undoes itself if it does not stay up.
Undoing restores the previous image, `.env` and compose file, and is watched the same way. With
nothing to return to, the service is stopped rather than left crash-looping.

**Enforced by:** Engineer — the release script, rehearsed (DE-9). Splitting it so the server half
runs unchanged under the rehearsal keeps the rehearsal honest.

### DE-5 (MUST) Check the image before assuming anything about the container.
Which user it runs as (`docker run --rm --entrypoint id <image> -u`), its entrypoint (some base
images already run an init such as `tini`; do not add `init: true` on top), and the permissions the
runtime command grants (TS-7).

**Why:** one service added a redundant init, and assumed its container ran as uid 1000 when the
base image's user was another uid; the assumption reached a second team before it was corrected.

**Enforced by:** Engineer, where the suite runs in the image and asserts its uid.

### DE-6 (SHOULD) A container runs as an unprivileged user.
`USER` in the Dockerfile, with the files it must write owned by that user.

**Why:** many base images run as root; a compromised service then owns everything mounted into it,
including the key it signs with (CR-1).

**Enforced by:** Engineer — the Dockerfile, and a test asserting the uid.

### DE-7 (SHOULD) A release refuses the revision the server already runs, unless told to.
Read what is running the way Compose reads the `.env` (`export`, spaces, quotes, CRLF, last line
wins) and refuse before anything is built or sent; an explicit flag (`--again`) releases it anyway.

**Why:** a release that repeats the running revision restarts every process for nothing, and is
usually a command that ran after the step it depended on had failed (SH-11).

**Enforced by:** Engineer — the release script, with a test.

### DE-8 (MUST) Trust a new server's host key only after checking it against its provider.
Never `StrictHostKeyChecking=no` or `accept-new`; a release script passes
`StrictHostKeyChecking=yes` whatever the local configuration says.

**Enforced by:** Engineer — the flag in the script.

### DE-9 (MUST) Rehearse every path of a deploy script before relying on it.
Run the server-side part locally against stand-in images or the real image, under a renamed Compose
project so nothing real is touched, through each path: missing configuration, first start,
replacement, a container that dies after starting, rollback, failed rollback. Deliver the script
the way production does (over stdin, as `ssh` does): run as a file, it hid a `docker compose run`
that read the rest of the script from stdin.

**Why:** release scripts run rarely and fail at the worst moment. Rehearsal found a rollback that
tried to pull from Docker Hub and left a broken image restarting.

**Enforced by:** Engineer — a rehearsal script that runs every path in one command, required by the
ship (SH-13) when deploy files change.

### DE-10 (SHOULD) Narrow the runtime's permissions, and test them against what production mounts. (PROPOSED for Node)
Run with the runtime's permission model where it has one, granting what the service needs and
nothing else. Node's `--permission` governs the file system (`--allow-fs-read`,
`--allow-fs-write`), child processes and workers, but network access only as all or nothing; Deno's
`--allow-*` also grants network access per host. Grant what the model allows, and test the
production command's grants against the paths the compose file mounts (TS-7).

**Why:** a compromised or confused process can then reach only what it was meant to. The grant
lists drift from the mounts unless something compares them.

**Enforced by:** Engineer — the permission flags and the contract test.

## Hosts

### DE-11 (SHOULD) Every host starts from the same baseline, set up by a script.
Docker from the OS package, enabled at boot; the Compose plugin at the version the deploying
workstations use, its published checksum verified; a deploy user in the `docker` group (which is
root-equivalent, so the host's logins matter); one directory per service; nothing listening but
`sshd` unless a service needs a port; the clock synchronized (`timedatectl` reports it), because
signed credentials are refused beyond a small clock skew (CR-6). Verify a Compose plugin with a
real `up`/`ps`/`down` of a throwaway project: `docker compose config` never talks to the engine.

**Enforced by:** Administer. Missing Engineer control: a bootstrap script that does all of this and
verifies it.

### DE-12 (MUST NOT) Print anything from shell startup outside an interactive login shell.
Guard output with `[[ $- == *i* ]] && shopt -q login_shell`; put customisations in drop-in files
(`~/.bashrc.d/`, one concern each) rather than editing the distribution's files. After any change,
`ssh <host> true | od -c` prints nothing.

**Why:** `scp`, `ssh host command` and every release script read the same startup files; one stray
byte corrupts `scp`'s protocol and a script's output.

**Enforced by:** Engineer — the `od -c` check, run by the bootstrap after installing anything.

### DE-13 (SHOULD) A shared host is named for the host, and each service adds its status to the login.
An interactive login runs each service's status module from a drop-in directory, each in its own
session with no stdin and a five-second limit (`setsid -w timeout -k 1 5 ... </dev/null`), with a
failure or timeout noted and never able to hold up or end the login. A module prints a few lines,
reads only, uses no `sudo` and no network call that can hang, and never prints a secret. The
release installs its module. Host-wide files are versioned and installed by script, not by hand.

**Why:** whoever logs in to a shared host should see at once what runs there and what is wrong. A
module that read the terminal once stopped `timeout`'s process group and hung the login for good;
under `set -e`, one failing module logged the user out.

**Enforced by:** Engineer — the runner's `setsid`, `timeout` and `</dev/null`.

### DE-14 (SHOULD) HTTPS terminates at one proxy per host, and a service holds no public port.
One reverse proxy (Caddy, for example) owns ports 80 and 443 and the certificates. A service joins
the proxy's network, is addressed only by aliases prefixed with its own name, publishes no port
beyond loopback, and installs its site configuration from its release. The proxy changes only under
a lock, after validating the whole configuration offline with the change in place, and puts the
previous files back if the running proxy refuses it.

**Why:** a proxy bundled with each service means two public services cannot share a host, and a
worker with no public face cannot be given an HTTPS route without taking the ports.

**Enforced by:** Engineer — the site installer's validation and rollback, rehearsed; a contract
test in each service refusing a production compose file that publishes a port.
