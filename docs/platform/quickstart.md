# Quickstart

Run the whole platform on your machine, open the console, and send one request through the gateway. It takes a few minutes and needs no configuration.

## Prerequisites

| Tool | Why |
| --- | --- |
| Bun 1.4.3 or later | Runs every service and command |
| Git | Clones the repository |
| Docker or Podman | Only if your machine has no PostgreSQL binaries: the runner then starts the PostgreSQL 18 image |

## Install

```bash
git clone https://github.com/ggpwnkthx/platform.git
cd platform
bun install
```

## Start the platform

```bash
bun run dev
```

The runner starts PostgreSQL, a development identity provider, Access, Data, the gateway and the console. It applies migrations, registers a workspace, and seeds a tenant, a user and grants. When everything is up it prints:

```
  gateway         http://localhost:8080
  Access  http://127.0.0.1:8081
  Data    http://127.0.0.1:8082
  console         http://localhost:8083
  identity        http://127.0.0.1:5556
  ...
  sign in with    alice@gateway.test / alice-password
  sign in at      http://localhost:8080/auth/login?redirect=/ws/11111111-1111-4111-8111-111111111111/v1/me
  workspace       11111111-1111-4111-8111-111111111111
```

Check the gateway is ready:

```bash
curl -s http://localhost:8080/readyz
```

## Open the console

1. Open http://localhost:8083/ in a browser.
2. Sign in as `alice@gateway.test` with password `alice-password`.
3. Open **Workspaces** to browse the seeded workspace, or **Status** to see the three services' probes.

## Send a request through the gateway

Open the printed sign-in address in a browser:

```
http://localhost:8080/auth/login?redirect=/ws/11111111-1111-4111-8111-111111111111/v1/me
```

Sign in with the same credentials. The browser returns to `/ws/11111111-1111-4111-8111-111111111111/v1/me`, and Data answers with your principal, tenant and workspace as JSON.

That one request crossed every service: the gateway sent you to Access, which sent you to the identity provider; Access then allowed the workspace, and the gateway forwarded the request to Data with a signed identity.

## Stop and reset

- Ctrl-C stops everything.
- `bun run dev --fresh` wipes the PostgreSQL data and starts over.

## Next

- [Development](development.md): other run modes, commands and tests.
- [Platform](README.md): how the services fit together.
- [Upstream identity](../gateway/upstream-identity.md): put your own service behind the gateway.
- [Operations](operations.md): deploy it.
