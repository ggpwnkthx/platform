# Guides

Step-by-step guides for jobs that cross more than one service, written in the order you do the work. Each one says who usually runs it, what must be true before you start, the steps with their commands, how to check the result and where to go when a step fails; the rules behind each step stay in the services' own pages.

## Set up

| Guide | Outcome |
| --- | --- |
| [Deploy the platform](deploy-the-platform.md) | A first production deployment of all four processes, verified end to end |
| [Onboard a tenant](onboard-a-tenant.md) | A new customer signed in through its own identity provider, with a first grant |
| [Monitor the platform](monitor-the-platform.md) | Probes, metrics, alerts and request tracing in place |

## Build

| Guide | Outcome |
| --- | --- |
| [Put a service behind the gateway](put-a-service-behind-the-gateway.md) | Your service reachable through a route, verifying the signed identity |
| [Build an app on Data](build-an-app-on-data.md) | Collections, policies and a workspace, called from code |

## Run

| Guide | Outcome |
| --- | --- |
| [Manage access](manage-access.md) | Grants, groups and roles changed, with an audit trail |
| [Troubleshoot a request](troubleshoot-a-request.md) | The service and the cause behind a failing request |
| [Rotate secrets](rotate-secrets.md) | Every secret replaced without dropping traffic |
| [Back up and restore](back-up-and-restore.md) | Backups of Access and Data, and a rehearsed restore |
| [Upgrade and roll back](upgrade-and-roll-back.md) | A new release rolled out, or the last one restored |
| [Respond to an incident](respond-to-an-incident.md) | An account or tenant cut off, secrets replaced, the facts gathered |

For jobs inside one service, use that service's pages: for example [Data modeling](../data/modeling.md), [Upstream identity](../gateway/upstream-identity.md), the [console user guide](../console/user-guide.md) or [CLI usage](../cli/usage.md).
