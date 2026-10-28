# Data service

The data service is the platform's headless data backend: a permission-aware API for workspace
records behind the [gateway](../gateway/README.md), taking each caller's capabilities from the
[access service](../access/README.md).

## How it fits

```
client ──▶ gateway ──▶ data service ──▶ PostgreSQL
                            └──▶ access service (access context)
```

The gateway authenticates the caller and signs its identity. The data service verifies the signature,
looks up the workspace, asks the access service for the principal's current capabilities, and applies
the deployment's policies to every record. Without the access service it fails closed.
Platform-wide topics are in [Platform](../platform/README.md).

## Concepts

| Concept | Meaning |
| --- | --- |
| Workspace | The unit of isolation, owned by one tenant. PostgreSQL row-level security keeps workspaces apart. |
| Collection | A table the deployment declares in its manifest. A workspace serves all of them, or only those it registers. |
| Policy bundle | What each permission grants per collection: rows, fields, actions. Grants themselves live in the access service. |
| Validator | A record's `ETag`; every update and delete must send the current one. |
| Receipt | A creation's answer, keyed by `Idempotency-Key`, so a retried `POST` creates one record. |
| Event | Committed with each change and delivered to trusted subscribers by the worker. |

## Next

| If you want to | Read |
| --- | --- |
| Run it and create a first record | [Getting started](getting-started.md) |
| Call it from code | [Client](client.md), [API](api.md) |
| Deploy and run it | [Configuration](configuration.md), [Operations](operations.md), [Troubleshooting](troubleshooting.md) |
| Know the exact rules | [Specification](spec.md) |
| Change the service | [Internals](internals.md), [Decisions](decisions.md) |

Changes: [Changelog](../../CHANGELOG.md).

## Release status

Version `1.0.0` is a **pre-production** release. It is implemented, passes its gates, and the
compatibility harness runs it against the real gateway and access service, but it has never run
outside that harness: no production history, no external users, no review by anyone but its author.
The next platform release is a release candidate; open findings and the gates outside the repository
are in [Internals](internals.md).
