# Documentation

The documentation of the platform's gateway, Access, Data, console and command line. Find your way in by the job you do, by the task in front of you, or by the service you are working with.

## New here

1. [Platform overview](platform/README.md): what the four processes are and how one request crosses them.
2. [Concepts](platform/concepts.md): the shared vocabulary, from tenant to policy bundle.
3. [Quickstart](platform/quickstart.md): the whole platform on your machine in a few minutes.
4. [Atlas](platform/atlas.html): the platform drawn on one page.

## By role

| You are | Start at |
| --- | --- |
| A platform operator | [sysops](roles/sysops.md) |
| A security engineer | [secops](roles/secops.md) |
| A database administrator | [dba](roles/dba.md) |
| An application developer | [developer](roles/developer.md) |
| A repository maintainer | [maintainer](roles/maintainer.md) |
| A console or CLI user | [end-user](roles/end-user.md) |

All roles and the pages each one reads: [By role](roles/README.md).

## By task

| You want to | Guide |
| --- | --- |
| Deploy the platform for the first time | [Deploy the platform](guides/deploy-the-platform.md) |
| Bring a new customer on | [Onboard a tenant](guides/onboard-a-tenant.md) |
| Grant or revoke access | [Manage access](guides/manage-access.md) |
| Expose your own service through the gateway | [Put a service behind the gateway](guides/put-a-service-behind-the-gateway.md) |
| Build an application on Data | [Build an app on Data](guides/build-an-app-on-data.md) |
| Set up monitoring and alerts | [Monitor the platform](guides/monitor-the-platform.md) |
| Find out why a request failed | [Troubleshoot a request](guides/troubleshoot-a-request.md) |
| Rotate a secret | [Rotate secrets](guides/rotate-secrets.md) |
| Back up or restore the databases | [Back up and restore](guides/back-up-and-restore.md) |
| Ship a new release, or back it out | [Upgrade and roll back](guides/upgrade-and-roll-back.md) |
| Handle a suspected compromise | [Respond to an incident](guides/respond-to-an-incident.md) |

All guides: [Guides](guides/README.md).

## By service

Every service directory uses the same page names, so the same kind of answer is in the same place.

| Service | Overview | Specification | API | Configuration | Operations | Troubleshooting | Internals | Decisions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gateway | [README](gateway/README.md) | [spec](gateway/spec.md) | [upstream identity](gateway/upstream-identity.md) | [configuration](gateway/configuration.md) | [operations](gateway/operations.md) | [troubleshooting](gateway/troubleshooting.md) | [internals](gateway/internals.md) | [decisions](gateway/decisions.md) |
| Access | [README](access/README.md) | [spec](access/spec.md) | [api](access/api.md) | [configuration](access/configuration.md) | [operations](access/operations.md) | [troubleshooting](access/troubleshooting.md) | [internals](access/internals.md) | [decisions](access/decisions.md) |
| Data | [README](data/README.md) | [spec](data/spec.md) | [api](data/api.md), [client](data/client.md) | [configuration](data/configuration.md) | [operations](data/operations.md) | [troubleshooting](data/troubleshooting.md) | [internals](data/internals.md) | [decisions](data/decisions.md) |
| Console | [README](console/README.md) | [spec](console/spec.md) | — | [configuration](console/configuration.md) | [operations](console/operations.md) | — | [workspace README](../packages/console/README.md) | — |
| CLI | [README](cli/README.md) | [spec](cli/spec.md) | — | [spec: profiles](cli/spec.md#3-profiles) | [usage](cli/usage.md) | [usage: refusals](cli/usage.md#when-something-refuses) | [workspace README](../packages/cli/README.md) | — |
| Platform | [README](platform/README.md) | — | — | [operations](platform/operations.md) | [operations](platform/operations.md) | — | [internals](platform/internals.md) | [decisions](platform/decisions.md) |

Service-specific guides: [Data getting started](data/getting-started.md), [Data modeling](data/modeling.md), [Console user guide](console/user-guide.md), [CLI usage](cli/usage.md), [Development](platform/development.md), [Security](platform/security.md).

## How to read the pages

| Page kind | What it is | Normative? |
| --- | --- | --- |
| Specification | The contract of a service's behavior | Yes: where another page disagrees, the spec wins |
| API, configuration | Exact reference for endpoints, variables and files | Describes the spec and the code |
| Operations, troubleshooting, guides | How to run, repair and use the platform | Advice that links to the rules |
| Internals, decisions | How the code is built and why it is that way | For maintainers |

Where each kind of content belongs, and the writing rules for these pages: [CONTRIBUTING.md](../CONTRIBUTING.md).
