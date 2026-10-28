# Data service

The data service is the platform's headless data backend: it serves permission-aware data APIs to
applications behind [the gateway](../../packages/gateway/) and takes each caller's identity and
capabilities from [the access service](../../packages/access/).

Platform-wide topics shared by all three services are in [Platform](../platform/).

## Start here

| You are | Read |
| --- | --- |
| An API consumer | [API](api.md), then [Client](client.md) |
| An operator | [Configuration](configuration.md), [Operations](operations.md) |
| A reviewer | [Specification](spec.md), [Security](security.md), [Decisions](decisions.md) |
| A contributor | [Development](development.md), [Architecture](architecture.md) |

## Pages

| Page | What it's for |
| --- | --- |
| [Architecture](architecture.md) | What the service is, how a request flows, code boundaries. |
| [Getting started](getting-started.md) | From an empty checkout to a running service on your machine. |
| [Configuration](configuration.md) | Environment variables, bindings file, manifests, policy bundles. |
| [API](api.md) | The stable v1 surface: paths, envelopes, errors, filters, change rules. |
| [Client](client.md) | The typed client `@data-backend/client` and collection types. |
| [Specification](spec.md) | The release's normative contract. |
| [Security](security.md) | Security model, review, open findings. |
| [Operations](operations.md) | Probes, metrics, logs, drain, catalog, secrets, alarms, migrations, retention. |
| [Compatibility](compatibility.md) | Integration baseline with the gateway and access service, and its harness. |
| [Backup and restore](backup-restore.md) | Backup, restore, and restore rehearsals. |
| [Troubleshooting](troubleshooting.md) | Errors by symptom, with cause and fix. |
| [Capacity](capacity.md) | The release's capacity report and what a deployment declares. |
| [Decisions](decisions.md) | Contract decisions with evidence, and implementation choices. |
| [Development](development.md) | Test suites, release gates, repository scripts. |
| [Release readiness](release.md) | Each `1.0.0` gate, including those outside the repository. |
| [Changelog](../../CHANGELOG.md) | Changes, newest first (one changelog for the platform). |

## Release status

**Version 1.0.0 is published as a pre-production release.** It is implemented, passes its own
gates, and the compatibility harness runs it against the real gateway and access service, but it has
never run outside that harness: no production history, no external users, and no review by anyone
other than the code's author. Open findings are in [Security](security.md).

**The next platform release is a release candidate.** Repository gates are green; the two gates
outside the repository are listed in [Release readiness](release.md).
