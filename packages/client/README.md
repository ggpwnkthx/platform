# The client of the platform

The console and the CLI are the two clients of the platform: they speak
to the gateway, to Access and to Data over HTTP, and they decide
nothing themselves.

The clients live here, once: the paths of the contracts, the queries
they take, the headers they carry, the refusals they answer and the
shapes of what the contracts answer. The console and the CLI read the
contracts here and keep the rest: how they show a refusal, how they
print an answer and how they speak to a service.

## What is here

| Module | What it holds |
| --- | --- |
| `src/transport.ts` | The port of the calls, the refusals of the services and the queries of the calls. |
| `src/data.ts` | The client of the data of a workspace, through the gateway. |
| `src/access.ts` | The client of the administration of Access, the client of the access context and the decision contract. |
| `src/probes.ts` | The probes of the services: `/healthz` and `/readyz`. |
| `src/types.ts` | The shapes of the contracts of the platform, as the clients read them. |

## The rules of the package

The package has no dependency, imports nothing of another workspace, has
no cycle and no catch-all directory. The check is
`bun run architecture`, and the engine of the check is
`tooling/client-architecture.ts` — the same engine that holds the
published client of Data (`packages/data/packages/client`).

## The boundary with the services

The services of the platform share nothing with this package: they are
separate deployments, they hold their own secrets and their own
databases, and they talk over HTTP. The decision is written in
`docs/platform/decisions.md` (decisions 1 and 2).

## The published client of Data

`@data-backend/client` (`packages/data/packages/client`) is the client
that is published for the consumers of the platform outside of this
repository. It is a separate artifact, with its own release and its own
contract; this package is the runtime of the console and of the CLI.
