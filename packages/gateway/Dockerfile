# syntax=docker/dockerfile:1

# The version of the runtime and the revision of the build are labels of the
# image: an operator has to know what is running without reading the logs.
ARG BUN_VERSION=1.4.3
ARG BUN_DIGEST=sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373
ARG VERSION=1.0.0
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
# copies one part of it: the image of the gateway held the links of the
# workspace and not the store they point at, and the process refused to
# start with `ENOENT reading "node_modules/chokidar"`.
#
# The development dependencies (the fixtures of the tests) are not part of
# the image of the gateway.
FROM oven/bun:${BUN_VERSION}-alpine@${BUN_DIGEST} AS runtime-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/access/package.json ./packages/access/
COPY packages/data/package.json ./packages/data/
COPY packages/data/packages/client/package.json ./packages/data/packages/client/
COPY packages/client/package.json ./packages/client/
COPY packages/console/package.json ./packages/console/
RUN bun install --frozen-lockfile --production --filter '@platform/gateway' --linker=hoisted && \
    rm -rf /root/.bun/install/cache

# ------------------------------------------------------------------- fixtures
#
# The development identity provider, the access fixture and the sample
# upstreams. They exist for the tests and for the local stack, they are not
# part of a deployment: the identity provider holds accounts with known
# passwords and the access fixture decides with a static policy.
#
# This stage is never used for the gateway. It refuses to start in an
# environment that is marked as production.
FROM oven/bun:${BUN_VERSION}-alpine@${BUN_DIGEST} AS fixtures
WORKDIR /app/packages/gateway
ENV NODE_ENV=development
# The fixtures need the development dependencies (the identity provider is
# one of them), so this stage installs everything.
COPY package.json bun.lock /app/
COPY packages/gateway/package.json /app/packages/gateway/
COPY packages/access/package.json /app/packages/access/
COPY packages/data/package.json /app/packages/data/
COPY packages/data/packages/client/package.json /app/packages/data/packages/client/
COPY packages/client/package.json /app/packages/client/
RUN cd /app && bun install --frozen-lockfile
COPY packages/gateway/src ./src
COPY packages/gateway/services ./services
COPY packages/gateway/package.json ./

USER bun
EXPOSE 5556
ENTRYPOINT ["bun", "run"]
CMD ["services/fixtures/oidc-provider.ts"]

# ------------------------------------------------------------------- access
#
# The reference implementation of Access. It is not part of
# the gateway: it is the service the gateway asks about the workspaces, and
# a deployment that has its own does not need this one. The implementation
# uses nothing but the runtime, so the image carries no dependency.
FROM oven/bun:${BUN_VERSION}-alpine@${BUN_DIGEST} AS access-service
WORKDIR /app/packages/gateway
ENV NODE_ENV=production

COPY packages/gateway/services/access-service.ts ./services/access-service.ts

USER bun
EXPOSE 8090
ENTRYPOINT ["bun", "run"]
CMD ["services/access-service.ts"]

# ---------------------------------------------------------- control binary
#
# The control plane is a separate process. It is the same code and the same
# dependencies, and it is compiled into a binary of its own for the
# deployments that run a binary and not the sources.
FROM oven/bun:${BUN_VERSION}-alpine@${BUN_DIGEST} AS control-binary
WORKDIR /app/packages/gateway
ENV NODE_ENV=production

# The dependencies are at the root of the tree: the resolution of a module
# walks the parents of the file, and the root is a parent of the workspace.
COPY --from=runtime-deps /app/node_modules /app/node_modules
COPY packages/gateway/src ./src
COPY packages/gateway/package.json ./

# The binary of the control plane: `gateway-control`. It listens on its own
# socket and it acts on the shared state directly.
RUN bun build --compile --minify --outfile /app/bin/gateway-control src/control-main.ts

USER bun
EXPOSE 9090
ENTRYPOINT ["/app/bin/gateway-control"]

# ------------------------------------------------------------------- runtime
#
# The production image contains the gateway and nothing else. The fixtures
# with their known accounts and their static policies are not copied into it.
FROM oven/bun:${BUN_VERSION}-alpine@${BUN_DIGEST} AS runtime
WORKDIR /app/packages/gateway

ARG VERSION
ARG REVISION
LABEL org.opencontainers.image.title="gateway" \
      org.opencontainers.image.description="An application gateway: it authenticates a caller, asks Access and forwards the request to a single upstream." \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/ggpwnkthx/platform" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    GATEWAY_CONFIG=/etc/platform/routes.json \
    GATEWAY_PORT=8080 \
    GATEWAY_CONTROL_PORT=9090

# The dependencies are at the root of the tree: the resolution of a module
# walks the parents of the file, and the root is a parent of the workspace.
COPY --from=runtime-deps /app/node_modules /app/node_modules
COPY packages/gateway/src ./src
COPY packages/gateway/config ./config
COPY packages/gateway/package.json ./

USER bun
EXPOSE 8080

# The gateway writes nothing: the route table is mounted read-only and the
# logs go to the standard output. The file system of the container can be
# read-only, apart from the temporary directory of the runtime.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:8080/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# The control plane is the same image with another command:
#
#   docker run --rm -p 9090:9090 ghcr.io/ggpwnkthx/gateway:1.0.0 \
#     bun run src/control-main.ts
#
# It is never published to the callers: it is internal.
ENTRYPOINT ["bun", "run"]
CMD ["src/main.ts"]
