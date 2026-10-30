# syntax=docker/dockerfile:1

# The version of the runtime and the revision of the build are labels of the
# image: an operator has to know what is running without reading the logs.
#
# The base image is pinned by digest: a tag is a name that moves, and the
# image of a release has to be the image that was built and scanned.
ARG BUN_VERSION=1.4.3
ARG BUN_DIGEST=sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373
ARG VERSION=1.0.1
ARG REVISION=unknown

# ---------------------------------------------------------------- dependencies
#
# The dependencies of the platform are one tree: the lockfile of the root
# holds the three workspaces. The packages of the three are copied because
# the installer reads them, and the tree of the workspace is the tree of
# the image.
#
# The installer is told to install **one** workspace and to lay the tree
# out **flat** (`--filter` and `--linker=hoisted`). The default layout of
# Bun is a farm of symbolic links that point into a store at the root of
# the tree, and a tree of links is a tree that breaks when the image
# copies one part of it: the image held the links of the workspace and
# not the store they point at, and the process refused to start with
# `ENOENT reading "node_modules/<package>"`.
#
# The development dependencies (the types of the tests) are not part of the
# image of the service.
FROM oven/bun:${BUN_VERSION}-alpine@${BUN_DIGEST} AS runtime-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/access/package.json ./packages/access/
COPY packages/data/package.json ./packages/data/
COPY packages/data/packages/client/package.json ./packages/data/packages/client/
COPY packages/client/package.json ./packages/client/
COPY packages/console/package.json ./packages/console/
RUN bun install --frozen-lockfile --production --filter '@platform/data' --linker=hoisted && \
    rm -rf /root/.bun/install/cache

# ------------------------------------------------------------------- runtime
#
# The production image contains the service and nothing else. There is no
# secret in it: the credentials of the database, of Access and of the
# signature are files that the deployment mounts, and they are read at the
# start of the process.
FROM oven/bun:${BUN_VERSION}-alpine@${BUN_DIGEST} AS runtime
WORKDIR /app/packages/data

ARG VERSION
ARG REVISION
LABEL org.opencontainers.image.title="data" \
      org.opencontainers.image.description="A headless, permission aware data API: it owns the workspaces, the collections, the policies, the records, the audit and the events." \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/ggpwnkthx/platform" \
      org.opencontainers.image.licenses="MIT"

ENV DATA_ENVIRONMENT=production \
    DATA_HOST=0.0.0.0 \
    DATA_PORT=8082 \
    DATA_PROCESS_ROLE=all \
    DATA_SCHEMA_BUNDLE_FILE=/app/packages/data/manifests/schema.json \
    DATA_POLICY_BUNDLE_FILE=/app/packages/data/manifests/policies.json

# The dependencies are at the root of the tree: the resolution of a module
# walks the parents of the file, and the root is a parent of the workspace.
COPY --from=runtime-deps /app/node_modules /app/node_modules
COPY packages/data/src ./src
# The operator commands of the deployment: the roles, the migrations and the
# workspaces. The harness of the compatibility is not part of the image.
COPY packages/data/scripts/cli ./scripts/cli
COPY packages/data/manifests ./manifests
COPY packages/data/migrations ./migrations
COPY packages/data/package.json ./

# The service runs as a user that is not root: a container that is root on
# the host of the container is root on the host.
USER bun
EXPOSE 8082

# The service writes nothing: the logs go to the standard output, and the
# file system of the container can be read-only. The bindings of the
# gateway, the manifests and the credentials are mounted read-only.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:8082/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["bun", "run"]
CMD ["src/main.ts"]
