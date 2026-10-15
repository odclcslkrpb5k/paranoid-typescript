# The examples' whole environment: the workstation needs only Docker (TC-9). Built from the
# repository's root, so the tools that read git history have it.
FROM node:24.22.0-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

# git, for the tools that read history. Pinned to the version this base's Debian release carries;
# when a security update replaces it, the build fails and the pin moves deliberately.
RUN apt-get update \
 && apt-get install --yes --no-install-recommends git=1:2.39.5-0+deb12u3 \
 && rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /repo/examples

# Dependencies first, in a layer of their own, so a source change does not reinstall them.
COPY --chown=node:node examples/package.json examples/package-lock.json examples/.npmrc ./
RUN npm ci && npm audit signatures

COPY --chown=node:node . /repo
CMD ["npm", "run", "check"]
