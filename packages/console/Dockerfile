# syntax=docker/dockerfile:1

# The version of the runtime and the revision of the build are labels of the
# image: an operator has to know what is running without reading the logs.
#
# The base image is pinned by digest: a tag is a name that moves, and the
# image of a release has to be the image that was built and scanned.
ARG BUN_VERSION=1.4.3
ARG BUN_DIGEST=sha256:629e17411f1f129dbec3af78d5af9c9f2a937435c80349437206c6b0b7422373
ARG VERSION=1.0.0
ARG REVISION=unknown

# ----------------------------------------------------------------------- build
#
# The dependencies of the platform are one tree: the lockfile of the root
# holds every workspace, and the packages of every workspace are copied
# because the installer reads them. The build needs Vite and HonoX; the
# image does not: the server Vite builds holds what it needs.
FROM oven/bun:${BUN_VERSION}-alpine@${BUN_DIGEST} AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/access/package.json ./packages/access/
COPY packages/data/package.json ./packages/data/
COPY packages/data/packages/client/package.json ./packages/data/packages/client/
COPY packages/console/package.json ./packages/console/
RUN bun install --frozen-lockfile && \
    rm -rf /root/.bun/install/cache
COPY tsconfig.base.json ./
# The documentation of the platform is read when the console is built,
# and the build holds it: the image holds the build of the server and
# nothing else, and the documents are a part of that build.
COPY docs ./docs
COPY tooling ./tooling
COPY packages/console ./packages/console
RUN bun run --cwd packages/console build

# ------------------------------------------------------------------- runtime
#
# The image holds the build of the console and the process that serves it,
# and nothing else: no module of the development, no source of a page, no
# secret. The credentials are the environment the deployment gives it.
FROM oven/bun:${BUN_VERSION}-alpine@${BUN_DIGEST} AS runtime
WORKDIR /app/packages/console

ARG VERSION
ARG REVISION
LABEL org.opencontainers.image.title="console" \
      org.opencontainers.image.description="The console of the platform: the web application that is the interface of the gateway, Access and Data." \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="https://github.com/ggpwnkthx/platform" \
      org.opencontainers.image.licenses="MIT"

ENV CONSOLE_ENVIRONMENT=production \
    CONSOLE_HOST=0.0.0.0 \
    CONSOLE_PORT=8083

COPY --from=build /app/packages/console/dist ./dist
COPY packages/console/src/main.ts ./src/main.ts
COPY packages/console/src/runtime/config.ts packages/console/src/runtime/log.ts packages/console/src/runtime/version.ts ./src/runtime/
COPY packages/console/package.json ./

# The console runs as a user that is not root, and it writes nothing: the
# logs go to the standard output and the file system can be read-only.
USER bun
EXPOSE 8083

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:8083/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["bun", "run"]
CMD ["src/main.ts"]
