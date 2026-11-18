ARG BUN_VERSION=1.4.4
ARG NGINX_VERSION=1.27-alpine

# The interface is a static site: every page and the client bundle are generated here.
FROM docker.io/oven/bun:${BUN_VERSION} AS build-ui
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN bun install --frozen-lockfile
COPY packages/ui ./packages/ui
COPY migrations ./migrations
RUN bun run build:ui

# The operator's tools: the installer, apply, harden. Never part of serving the interface.
FROM docker.io/oven/bun:${BUN_VERSION} AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/ui/package.json ./packages/ui/package.json
RUN bun install --frozen-lockfile --production

FROM docker.io/oven/bun:${BUN_VERSION}-distroless AS cli
WORKDIR /app
COPY --from=dependencies /app/packages/cli/node_modules ./packages/cli/node_modules
# Owned by the user the tools run as, so a checkout with private file modes still runs.
COPY --chown=65532:65532 package.json ./
COPY --chown=65532:65532 packages/cli ./packages/cli
COPY --chown=65532:65532 migrations ./migrations
USER 65532:65532
ENTRYPOINT ["bun", "packages/cli/src/cli.ts"]

# The interface: files, served by nginx, with /pg forwarded to the relay. No application server.
FROM docker.io/nginxinc/nginx-unprivileged:${NGINX_VERSION} AS ui
COPY --chmod=0644 deploy/ui/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=0755 deploy/ui/platform.sh /docker-entrypoint.d/30-platform.sh
COPY --from=build-ui --chmod=0755 /app/packages/ui/dist /usr/share/nginx/html
EXPOSE 8080
