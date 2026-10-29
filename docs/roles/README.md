# By role

Pick the job you do and start from its page. Each role page lists what that job owns, the pages to read first, the guides for its recurring tasks and where to look when something breaks. The pages it links to belong to the services and the guides; nothing is copied here.

In the console's built-in docs, choosing a role turns its page into the navigation: the sidebar and the previous and next links follow it ([console spec §6.4](../console/spec.md#64-documentation)).

## Roles

| Role | You own | Start at |
| --- | --- | --- |
| Platform operator | Deployments, configuration, monitoring, upgrades and rollbacks of the four processes | [sysops.md](sysops.md) |
| Security engineer | Trust boundaries, identity, secrets and their rotation, incident response | [secops.md](secops.md) |
| Database administrator | The PostgreSQL of Access, Data and, optionally, the gateway's shared state | [dba.md](dba.md) |
| Application developer | Code that calls Data, Access or the gateway, and services you put behind the gateway | [developer.md](developer.md) |
| Repository maintainer | The code, tests, decisions and releases of the repository | [maintainer.md](maintainer.md) |
| Console and CLI user | Daily work with records, tenants and status in the console or `platformctl` | [end-user.md](end-user.md) |

## Guides by role

A filled circle marks the roles that usually run a guide.

| Guide | Operator | Security | DBA | Developer | Maintainer | User |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| [Deploy the platform](../guides/deploy-the-platform.md) | ● | ● | ● | — | — | — |
| [Onboard a tenant](../guides/onboard-a-tenant.md) | ● | — | — | — | — | ● |
| [Manage access](../guides/manage-access.md) | ● | ● | — | — | — | ● |
| [Put a service behind the gateway](../guides/put-a-service-behind-the-gateway.md) | ● | ● | — | ● | — | — |
| [Build an app on Data](../guides/build-an-app-on-data.md) | — | — | ● | ● | — | — |
| [Monitor the platform](../guides/monitor-the-platform.md) | ● | ● | ● | — | — | — |
| [Troubleshoot a request](../guides/troubleshoot-a-request.md) | ● | — | — | ● | ● | ● |
| [Rotate secrets](../guides/rotate-secrets.md) | ● | ● | ● | — | — | — |
| [Back up and restore](../guides/back-up-and-restore.md) | ● | — | ● | — | — | — |
| [Upgrade and roll back](../guides/upgrade-and-roll-back.md) | ● | — | ● | — | ● | — |
| [Respond to an incident](../guides/respond-to-an-incident.md) | ● | ● | — | — | — | — |

## Service pages by role

| Page kind | Operator | Security | DBA | Developer | Maintainer | User |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| Overview (`README.md` of each service) | ● | ● | ● | ● | ● | ● |
| Specification (`spec.md`) | ● | ● | ● | ● | ● | — |
| API reference (`api.md`, `client.md`, `upstream-identity.md`) | — | ● | — | ● | — | — |
| Configuration (`configuration.md`) | ● | ● | ● | ● | — | — |
| Operations (`operations.md`) | ● | ● | ● | — | ● | — |
| Troubleshooting (`troubleshooting.md`) | ● | ● | ● | ● | — | ● |
| Console user guide, CLI usage | ● | — | — | ● | — | ● |
| Internals and decisions (`internals.md`, `decisions.md`) | — | ● | ● | — | ● | — |

## Everyone

Whatever your job, three pages give you the shape of the platform: the [platform overview](../platform/README.md), the [concepts](../platform/concepts.md) glossary and the [atlas](../platform/atlas.html), which draws every process and walks one request across them.
