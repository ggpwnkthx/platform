# Data

Data is the platform's headless data backend: a permission-aware API for workspace records behind the [gateway](../gateway/README.md), which takes each caller's capabilities from [Access](../access/README.md). This page is the overview for everyone; it says what Data does and where to read next.

## What it does

| Data does | Data does not |
| --- | --- |
| Verify the gateway's signed identity with the gateway's public key. | Log users in, issue tokens or keep sessions. |
| Keep the workspace registry and each workspace's catalog of collections. | Keep principals, groups or grants: Access owns them. |
| Serve records, metadata, aggregates, search, version history and audit metadata over a versioned HTTP API. | Serve a studio, forms, dashboards or any user interface. |
| Apply the deployment's policies to every row and field, inside PostgreSQL row-level security. | Create or alter tables at runtime: tables come from reviewed migrations. |
| Commit each change with its audit entry and event, and deliver events to trusted subscribers. | Run uploaded plugins, webhooks or workflows. |

## How it fits

```text
client ──▶ gateway ──▶ Data ──▶ PostgreSQL
                            └──▶ Access (access context)
```

The gateway authenticates the caller and signs its identity. Data verifies the signature, looks up the workspace, asks Access for the principal's current capabilities, and applies the policies to every record. When Access does not answer, Data fails closed. Platform-wide topics are in [Platform](../platform/README.md).

## Key concepts

| Concept | Meaning |
| --- | --- |
| Workspace | The unit of isolation, owned by one tenant. PostgreSQL row-level security keeps workspaces apart. |
| Collection | A table the deployment declares in its manifest. A workspace serves all of them, or only those it registers. |
| Policy bundle | What each permission grants per collection: rows, fields, actions. Grants themselves live in Access. |
| Workspace model | A workspace's own labels, constraints, relations and served fields over the deployment's collections. |
| Validator | A record's `ETag`; every update and delete must send the current one. |
| Receipt | A creation's answer, keyed by `Idempotency-Key`, so a retried `POST` creates one record. |
| Event | Committed with each change and delivered to trusted subscribers by the worker. |

The full vocabulary is in the [spec's terms](spec.md#terms).

## Find your way

| If you want to | Read |
| --- | --- |
| Run it and create a first record | [Getting started](getting-started.md) |
| Call it from code | [Client](client.md), [API reference](api.md) |
| Add a collection, write policies, shape a workspace | [Modeling](modeling.md) |
| Configure a deployment | [Configuration](configuration.md) |
| Run it in production | [Operations](operations.md) |
| Fix an error | [Troubleshooting](troubleshooting.md) |
| Know the exact rules | [Specification](spec.md) |
| Change the service | [Internals](internals.md), [Decisions](decisions.md) |

Changes are listed in the [changelog](../../CHANGELOG.md).

## Release status

Version `1.0.0` is a **pre-production** release. It is implemented, passes its gates, and the compatibility harness runs it against the real gateway and Access. It has never run outside that harness: it has no production history, no external users, and no review by anyone but its author. The next platform release is a release candidate; open findings and the gates outside the repository are in [Internals](internals.md#release-readiness).
