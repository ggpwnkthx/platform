# Console

The console is the platform's web interface: people read and change workspace data, operators administer tenants, and anyone can check service status or read these docs. This page explains what it is for and where to go next.

## What it does

The console is a client of the gateway, Access and Data. It signs people in at Access, reads and writes workspace records through the gateway, and administers tenants through Access's administration API. It reaches no database, decides nothing on its own, and offers no API for other programs: every answer it shows comes from a service, under that service's spec.

It does not decide access, sign identities, hold the gateway's identity-signing key or cache decisions. The full list is in [spec §9](spec.md#9-out-of-scope).

## Where it sits

```text
browser ──> console ──> Access    sign-in, access context, tenant administration
                │
                ├─────> gateway ──> Data    workspace records, with the caller's token
                │
                └─────> Data      probes only, for the status board
```

## Places

| Place | Address | For | Opens for |
| --- | --- | --- | --- |
| Overview | `/` | The places you can open and the state of the services | Everyone; without a session it offers sign-in |
| Workspaces | `/workspaces` | Browsing, searching, editing and aggregating a workspace's records; its data model and audit | People who hold rights in a workspace |
| Operators | `/operators` | Tenants, users, groups, rights, roles and the administration audit | Operators holding `console.admin` (their tenant) or `console.platform` (every tenant) |
| Status | `/status` | Service health and readiness, and the platform map | Everyone; the detail needs `console.status` |
| Documentation | `/docs` | This `docs/` tree, rendered from the console build and arranged around the reader's role | Everyone, without signing in |
| You | `/me` | Your subject, tenant and scope keys | Everyone signed in |

Each place, with the service calls behind it: [spec §6.2](spec.md#62-places).

## Key concepts

| Concept | Meaning | Defined in |
| --- | --- | --- |
| Session | The browser holds only a signed session identifier; the caller's token stays on the server. | [spec §3](spec.md#3-sessions) |
| Operator scope | The keys `console.status`, `console.admin` and `console.platform`, read from Access on every page. | [spec §4](spec.md#4-operator-scope) |
| Ability | What the console shows mirrors what the services allow: it may hide an action, never grant one. | [spec §5](spec.md#5-ability) |
| Documentation | The console serves this `docs/` tree from its build, arranged around the role the reader chooses. | [spec §6.4](spec.md#64-documentation) |

## Find your way

| To | Read |
| --- | --- |
| Use the console day to day, or administer a tenant | [User guide](user-guide.md) |
| Try it locally | [Quickstart](../platform/quickstart.md) |
| Set its environment variables and register it at Access | [Configuration](configuration.md) |
| Deploy and run it, and see which credentials it holds | [Operations](operations.md) |
| Know exactly what it does and refuses | [Specification](spec.md) |
| Change its code | [Workspace README](../../packages/console/README.md) |

## Status

Version 1.0.0. The code lives in [`packages/console/`](../../packages/console/), a [HonoX](https://github.com/honojs/honox) app rendered on the server and built with Vite; interactive parts are islands. A `§N` reference in the console's code, tests or these pages points to a section of [spec.md](spec.md).
