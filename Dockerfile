ARG BUN_VERSION=1.4.4

# The interface is a static site: every page and the client bundle are generated here.
# The result is a directory of files, published to a CDN. It is not a container.
FROM docker.io/oven/bun:${BUN_VERSION} AS build-ui
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/data/package.json ./packages/data/package.json
COPY packages/pg-client/package.json ./packages/pg-client/package.json
COPY packages/relay/package.json ./packages/relay/package.json
COPY packages/vocabulary/package.json ./packages/vocabulary/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN bun install --frozen-lockfile
COPY packages/cli ./packages/cli
COPY packages/data ./packages/data
COPY packages/pg-client ./packages/pg-client
COPY packages/ui ./packages/ui
COPY packages/vocabulary ./packages/vocabulary
COPY migrations ./migrations
RUN bun run build:ui

# The operator's tools: the installer, apply, harden. Never part of serving the interface.
FROM docker.io/oven/bun:${BUN_VERSION} AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/data/package.json ./packages/data/package.json
COPY packages/pg-client/package.json ./packages/pg-client/package.json
COPY packages/relay/package.json ./packages/relay/package.json
COPY packages/vocabulary/package.json ./packages/vocabulary/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN bun install --frozen-lockfile --production

FROM docker.io/oven/bun:${BUN_VERSION}-distroless AS cli
WORKDIR /app
# Bun keeps the packages themselves in the root store and links each workspace to them, so the
# store and the links travel together: the links alone would point at nothing.
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/packages/cli/node_modules ./packages/cli/node_modules
COPY --from=dependencies /app/packages/data/node_modules ./packages/data/node_modules
COPY --from=dependencies /app/packages/ui/node_modules ./packages/ui/node_modules
# Owned by the user the tools run as, so that a checkout with private file modes still runs.
COPY --chown=65532:65532 package.json ./
COPY --chown=65532:65532 packages/cli ./packages/cli
COPY --chown=65532:65532 packages/data ./packages/data
COPY --chown=65532:65532 packages/pg-client ./packages/pg-client
COPY --chown=65532:65532 packages/ui ./packages/ui
COPY --chown=65532:65532 packages/vocabulary ./packages/vocabulary
COPY --chown=65532:65532 migrations ./migrations
USER 65532:65532
ENTRYPOINT ["bun", "packages/cli/src/cli.ts"]

# The relay: the WebSocket in front of PostgreSQL's port. It holds no credentials and reads
# nothing it carries; the token inside the stream is PostgreSQL's to check.
FROM docker.io/oven/bun:${BUN_VERSION}-distroless AS relay
WORKDIR /app
COPY --chown=65532:65532 packages/relay ./packages/relay
USER 65532:65532
ENTRYPOINT ["bun", "packages/relay/src/relay.ts"]
