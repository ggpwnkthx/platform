# Platform operator

You deploy the gateway, Access, Data and the console, keep them healthy and roll them forward or back. This page gathers what you need for that: the order to read things in, the tasks you will repeat, the reference you will look values up in, and where to go when something breaks.

## What you own

| Area | What it covers |
| --- | --- |
| Deployments | Four processes plus `gateway-control`, their images, replicas, ports and probes |
| Configuration | The `GATEWAY_*`, `ACCESS_*`, `DATA_*` and console variables, the route table, Data's bindings file, manifest and policy bundle |
| Shared state | Redis or PostgreSQL behind the gateway, Redis behind Access |
| Secrets | Generating, mounting and rotating them, together with [security operations](secops.md) |
| Monitoring | Probes, metrics, alerts, logs |
| Releases | Upgrades, rollbacks, tenant cutovers |

## Start here

1. [Platform overview](../platform/README.md) and the [atlas](../platform/atlas.html), for the four processes and what each one talks to.
2. [Quickstart](../platform/quickstart.md), to see the platform run on one machine.
3. [Platform operations](../platform/operations.md), for the conventions every service shares.
4. [Deploy the platform](../guides/deploy-the-platform.md), for the first production rollout step by step.
5. [Monitor the platform](../guides/monitor-the-platform.md), before you take traffic.

## Common tasks

| Task | Guide |
| --- | --- |
| First production deployment | [Deploy the platform](../guides/deploy-the-platform.md) |
| Bring a new customer onto the platform | [Onboard a tenant](../guides/onboard-a-tenant.md) |
| Publish a new or changed route | [Put a service behind the gateway](../guides/put-a-service-behind-the-gateway.md), [Gateway operations: changing the route table](../gateway/operations.md#changing-the-route-table) |
| Wire probes, metrics and alerts | [Monitor the platform](../guides/monitor-the-platform.md) |
| Upgrade a release, or back it out | [Upgrade and roll back](../guides/upgrade-and-roll-back.md) |
| Rotate a secret | [Rotate secrets](../guides/rotate-secrets.md) |
| Move a tenant between deployments of Access | [Access operations: tenant cutover](../access/operations.md#tenant-cutover) |
| Sign callers out everywhere | [Gateway operations: revoking sessions](../gateway/operations.md#revoking-sessions) |
| Operate from a terminal | [CLI usage](../cli/usage.md) |

## Reference

| Service | Configuration | Operations | Troubleshooting |
| --- | --- | --- | --- |
| Gateway and `gateway-control` | [Configuration](../gateway/configuration.md) | [Operations](../gateway/operations.md) | [Troubleshooting](../gateway/troubleshooting.md) |
| Access | [Configuration](../access/configuration.md) | [Operations](../access/operations.md) | [Troubleshooting](../access/troubleshooting.md) |
| Data | [Configuration](../data/configuration.md) | [Operations](../data/operations.md) | [Troubleshooting](../data/troubleshooting.md) |
| Console | [Configuration](../console/configuration.md) | [Operations](../console/operations.md) | [User guide](../console/user-guide.md) |
| CLI | [Spec: files](../cli/spec.md#8-files) | [Usage](../cli/usage.md) | [Usage: when something refuses](../cli/usage.md#when-something-refuses) |

| Shared fact | Page |
| --- | --- |
| Ports, addresses and probes of every service | [Platform operations: addresses](../platform/operations.md#addresses), [probes](../platform/operations.md#probes) |
| How secrets are delivered | [Platform operations: secrets as files](../platform/operations.md#secrets-as-files) |
| Images, binaries and versions | [Platform operations: images and binaries](../platform/operations.md#images-and-binaries), [versions](../platform/operations.md#versions) |
| The gateway's shared-state roles | [Gateway operations: shared state](../gateway/operations.md#shared-state) |
| Compose stacks and Kubernetes manifests | [Deploy directory](../../deploy/README.md) |

## Production readiness checklist

- [ ] The gateway, Access and Data run in production mode and start cleanly; each validates its environment at start and names what is missing, so a clean start is the first check ([platform environment conventions](../platform/operations.md#environment-conventions)).
- [ ] The gateway and Access use a shared store, not process memory, once more than one replica runs.
- [ ] The control plane's socket stays internal and never sits behind the public ingress ([Gateway operations: control plane](../gateway/operations.md#control-plane)).
- [ ] Data is reachable only through the gateway: a direct call without the signed identity gets `401`.
- [ ] Metrics tokens are set and each `/metrics` endpoint is scraped.
- [ ] The alerts of each service's operations page are in place.
- [ ] Backups of the Access and Data databases have been restored once in a rehearsal ([Back up and restore](../guides/back-up-and-restore.md)).
- [ ] The gateway's [deployment review](../gateway/operations.md#deployment-review) is done.

## When it breaks

| Symptom | Start at |
| --- | --- |
| A caller reports an error | [Troubleshoot a request](../guides/troubleshoot-a-request.md) |
| A readiness probe answers `503` | [Gateway](../gateway/troubleshooting.md#startup-and-readiness), [Access](../access/troubleshooting.md#start-refusals), [Data](../data/troubleshooting.md#503-on-readiness) |
| Sign-ins fail | [Access troubleshooting: failed logins](../access/troubleshooting.md#failed-logins) |
| The gateway answers `503 access_unavailable` | [Gateway troubleshooting](../gateway/troubleshooting.md#503-access_unavailable) |
| A release misbehaves | [Upgrade and roll back](../guides/upgrade-and-roll-back.md) |
| You suspect a compromise | [Respond to an incident](../guides/respond-to-an-incident.md) |
