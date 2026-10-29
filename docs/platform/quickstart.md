# Quickstart

Run the whole platform on your machine, open the console and send one request through the gateway. It takes a few minutes, needs no configuration, and suits anyone trying the platform for the first time.

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

1. Start everything:

   ```bash
   bun run dev
   ```

2. Wait for the address list. The runner starts PostgreSQL, a development identity provider, Access, Data, the gateway and the console; applies migrations; registers a workspace; and seeds a tenant, a user and grants. When everything is up it prints:

   ```text
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

3. Check that the gateway is ready:

   ```bash
   curl -s http://localhost:8080/readyz
   ```

## Open the console

1. Open http://localhost:8083/ in a browser.
2. Sign in as `alice@gateway.test` with password `alice-password`.
3. Open **Workspaces** to browse the seeded workspace, or **Status** to see the three services' probes.

## Send a request through the gateway

1. Open the sign-in address the runner printed:

   ```text
   http://localhost:8080/auth/login?redirect=/ws/11111111-1111-4111-8111-111111111111/v1/me
   ```

2. Sign in with the same credentials.
3. The browser returns to `/ws/11111111-1111-4111-8111-111111111111/v1/me`, and Data answers with your principal, tenant and workspace as JSON.

This single request touched every service: the gateway, Access, the identity provider and Data. [A request, end to end](README.md#a-request-end-to-end) explains each hop.

## Stop and reset

| To | Do |
| --- | --- |
| Stop everything | Press Ctrl-C |
| Wipe the PostgreSQL data and start over | Run `bun run dev --fresh` |

## Next steps

| To | Read |
| --- | --- |
| Try other run modes, commands and tests | [Development](development.md) |
| Understand how the services fit together | [Platform](README.md) |
| Put your own service behind the gateway | [Upstream identity](../gateway/upstream-identity.md) |
| Deploy it | [Operations](operations.md) |
