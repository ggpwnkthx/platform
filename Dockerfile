ARG BUN_VERSION=1.4.4
ARG BUN_DIGEST=sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d
ARG BUN_DISTROLESS_DIGEST=sha256:153a951ae40106e125898103e6e990ee0f38e6aee7f561029e26cf9fbed23470

# The site of the local stack: a built folder, served as the files it is. A real deployment
# publishes the folder to a CDN.
FROM docker.io/oven/bun:${BUN_VERSION}-distroless@${BUN_DISTROLESS_DIGEST} AS site
WORKDIR /app
COPY --chown=65532:65532 packages/cli/src/serve.ts ./packages/cli/src/serve.ts
USER 65532:65532
ENTRYPOINT ["bun"]

FROM docker.io/oven/bun:${BUN_VERSION}-distroless@${BUN_DISTROLESS_DIGEST} AS relay
WORKDIR /app
COPY --chown=65532:65532 packages/relay ./packages/relay
USER 65532:65532
ENTRYPOINT ["bun", "packages/relay/src/relay.ts"]
