# Application developer

You write code that uses the platform: an application that reads and writes workspace data, a service you put behind the gateway, or a tool that administers tenants. Callers only ever reach the gateway, which asks Access before it forwards anything; this page shows where each part of that conversation is documented and which guide to follow for each job.

## Start here

1. [Platform overview](../platform/README.md), especially the request walked end to end.
2. [Concepts](../platform/concepts.md), for tenants, principals, workspaces, routes and grants.
3. [Quickstart](../platform/quickstart.md), to run everything locally and send a first request.
4. The guide for what you are building, below.

## What are you building?

| You want to | Follow | Then keep open |
| --- | --- | --- |
| Store and query data for an application | [Build an app on Data](../guides/build-an-app-on-data.md) | [Data API](../data/api.md), [Typed client](../data/client.md), [Modeling](../data/modeling.md) |
| Expose your own HTTP service to platform callers | [Put a service behind the gateway](../guides/put-a-service-behind-the-gateway.md) | [Upstream identity](../gateway/upstream-identity.md), [Gateway spec §3](../gateway/spec.md#3-configuration-file) |
| Automate tenant, principal and grant administration | [Onboard a tenant](../guides/onboard-a-tenant.md), [Manage access](../guides/manage-access.md) | [Access API](../access/api.md) |
| Script against a deployment from a terminal | [CLI usage](../cli/usage.md) | [CLI spec §5](../cli/spec.md#5-commands), [§6](../cli/spec.md#6-output) |
| Try Data on its own first | [Data: getting started](../data/getting-started.md) | [Data configuration](../data/configuration.md) |

## Contracts you code against

| Contract | Owner | Reference |
| --- | --- | --- |
| Data's v1 HTTP API: envelopes, filters, cursors, validators, idempotency, errors | Data | [Data spec §9](../data/spec.md#9-http-api), [Data API](../data/api.md) |
| Data's version and compatibility promise | Data | [Data spec §13](../data/spec.md#13-versions-and-compatibility) |
| The typed client and its errors | Data | [Typed client](../data/client.md) |
| The signed identity your upstream receives | Gateway | [Gateway spec §7.1](../gateway/spec.md#71-request-→-upstream), [§7.4](../gateway/spec.md#74-identity-signature) |
| The route table | Gateway | [Gateway spec §3](../gateway/spec.md#3-configuration-file) |
| The gateway's own error codes | Gateway | [Gateway spec §2.5](../gateway/spec.md#25-response-codes) |
| Login, tokens, decisions and administration | Access | [Access API](../access/api.md), [Access spec](../access/spec.md) |

Each spec is normative: when a guide or an example disagrees with it, the spec is right and the guide is a bug.

## Your local loop

| Task | Page |
| --- | --- |
| Run the whole platform | [Quickstart](../platform/quickstart.md) |
| Choose a run mode, run the tests | [Development](../platform/development.md) |
| Run Data alone or with a worker | [Data: getting started](../data/getting-started.md) |
| Run the gateway with fixtures | [Development: gateway with fixtures](../platform/development.md#gateway-with-fixtures) |

## When a call fails

Start with [Troubleshoot a request](../guides/troubleshoot-a-request.md): it tells you which service produced the answer and sends you to the right entry.

| Answer | Where |
| --- | --- |
| A gateway error such as `401 unauthorized`, `403 workspace_forbidden` or `502 bad_gateway` | [Gateway troubleshooting](../gateway/troubleshooting.md) |
| A Data error such as `403 FORBIDDEN`, `409`, `412 PRECONDITION_FAILED` or `422 RESULT_TOO_LARGE` | [Data troubleshooting](../data/troubleshooting.md), [Data spec §9.7](../data/spec.md#97-errors) |
| An Access refusal on login, tokens or administration | [Access troubleshooting](../access/troubleshooting.md) |
| A typed client error | [Typed client: errors](../data/client.md#errors) |
