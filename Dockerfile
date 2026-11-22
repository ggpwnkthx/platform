ARG BUN_VERSION=1.4.4
ARG BUN_DIGEST=sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d
ARG BUN_DISTROLESS_DIGEST=sha256:153a951ae40106e125898103e6e990ee0f38e6aee7f561029e26cf9fbed23470

# The workspace with its production dependencies: what the operator's tools run from.
FROM docker.io/oven/bun:${BUN_VERSION}@${BUN_DIGEST} AS app
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
COPY examples/newsroom/package.json ./examples/newsroom/package.json
COPY migrations ./migrations
RUN bun install --frozen-lockfile --production

# The operator's tools: migrate, apply, doctor, harden, and `ui serve` for the local stack.
FROM docker.io/oven/bun:${BUN_VERSION}-distroless@${BUN_DISTROLESS_DIGEST} AS cli
WORKDIR /app
COPY --from=app --chown=65532:65532 /app ./
USER 65532:65532
ENTRYPOINT ["bun", "packages/cli/src/cli.ts"]

# The relay: one file, no dependencies.
FROM docker.io/oven/bun:${BUN_VERSION}-distroless@${BUN_DISTROLESS_DIGEST} AS relay
WORKDIR /app
COPY --chown=65532:65532 packages/relay ./packages/relay
USER 65532:65532
ENTRYPOINT ["bun", "packages/relay/src/relay.ts"]
