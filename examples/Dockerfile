# The examples' whole environment: the workstation needs only Docker (TC-9). Built from the
# repository's root, so the tools that read git history have it.
FROM node:24.22.0-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

# git, for the tools that read history, and the CA certificates the vulnerability check's TLS needs.
# Pinned to the versions this base's Debian release carries; when a security update replaces one,
# the build fails and the pin moves deliberately.
RUN apt-get update \
 && apt-get install --yes --no-install-recommends git=1:2.39.5-0+deb12u3 \
      ca-certificates=20250419~deb12u2 \
 && rm -rf /var/lib/apt/lists/*

# osv-scanner for the vulnerability check (TC-10): a static binary, copied from its release image by
# digest (v2.7.0), so a re-pushed tag cannot change it.
COPY --from=ghcr.io/google/osv-scanner@sha256:4f3b7e2c64b9d38a5febc5a7e4a3dfef1d1362f726dea7a2ef4762b46469fcd0 \
     /osv-scanner /usr/local/bin/osv-scanner

USER node
WORKDIR /repo/examples

# Dependencies first, in a layer of their own, so a source change does not reinstall them.
COPY --chown=node:node examples/package.json examples/package-lock.json examples/.npmrc ./
RUN npm ci && npm audit signatures

COPY --chown=node:node . /repo
CMD ["npm", "run", "check"]
