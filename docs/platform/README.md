# Platform

What the three services have in common: the repository, local development, deployment, release, security and the compatibility baseline. Each service's contract lives in its own directory and is normative.

## Pages

| Page | What it covers |
| --- | --- |
| [architecture.md](architecture.md) | Repository layout, workspaces and the boundaries between them |
| [atlas.html](atlas.html) | The whole platform on one page: stations, contracts, and a request walked across the map |
| [development.md](development.md) | Local development: prerequisites, run modes, commands, tests |
| [operations.md](operations.md) | Deploying, configuring and running the platform |
| [release.md](release.md) | Cutting, publishing and verifying a release |
| [security.md](security.md) | Trust boundaries, secrets, least privilege, reporting a finding |
| [compatibility.md](compatibility.md) | The compatibility baseline and the suites that prove it |
| [decisions.md](decisions.md) | Repository-level decisions and their evidence |

Service contracts: [gateway](../gateway/README.md), [access service](../access/README.md), [data service](../data/README.md), [console](../console/README.md). For a side-by-side comparison of the services, see [Documentation](../README.md).

## Gateway

The only service callers reach. It has no domain model: workspaces, roles and quotas live in the access service. For each request it:

1. **Authenticates the caller.** OpenID Connect with PKCE for browsers, bearer tokens for API clients, in four modes that decide predictably which credential a route accepts.
2. **Asks the access service.** The gateway fails closed: no answer means refusal.
3. **Forwards the request.** It writes the caller's identity and signs it with a JWS that the upstream verifies with a standard library.

## Access service

An OIDC broker and access decision service. It authenticates callers against each tenant's identity provider, maps external identities to principals, issues its own tokens to the gateway, and answers the gateway's decisions. It holds the platform's identity data: tenants, principals, groups, grants and the administration audit.

## Data service

A headless, permission-aware data API. It owns workspaces, registered collections, data policies, records, audit history, record version history and committed events. It is a standalone deployment that neither serves nor depends on a studio; a studio is just another client.

## One repository

The three services are three processes and three deployments, kept as workspaces of one repository:

- one `bun install` installs all three;
- one lockfile pins every dependency;
- one CI run proves all three;
- one release publishes three images and three binaries;
- one compatibility baseline proves they still talk to each other.

The merge is of source, not runtime: services talk over HTTP, and no workspace imports another's source.
