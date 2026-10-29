# Security engineer

You answer for the platform's trust: who may sign in, what a signed-in caller may reach, which secrets exist and who holds them, and what happens when one leaks. This page maps those questions to the pages that answer them and to the playbooks you run.

## The trust model in one paragraph

A tenant's identity provider says who a caller is; Access maps that identity to a principal and decides, from grants alone, what the principal may do; the gateway enforces the decision and signs the caller's identity into every request it forwards; Data and other upstreams trust only that signature. Every hop fails closed. The full model, with each boundary and the secret that guards it, is in [Platform security](../platform/security.md).

## Start here

1. [Platform security](../platform/security.md): trust boundaries, secrets, least privilege.
2. [Gateway spec §5](../gateway/spec.md#5-authentication), [§6](../gateway/spec.md#6-workspace-access) and [§7.4](../gateway/spec.md#74-identity-signature): how callers are authenticated, checked and signed.
3. [Access spec §5](../access/spec.md#5-login), [§8](../access/spec.md#8-decisions) and [§4](../access/spec.md#4-environment): login brokering, decisions and secret handling.
4. [Data spec §4](../data/spec.md#4-gateway-trust-contract) and [§8](../data/spec.md#8-data-authorization): what Data trusts and how it authorizes each record.
5. [Respond to an incident](../guides/respond-to-an-incident.md), so you know the playbook before you need it.

## Common tasks

| Task | Guide or page |
| --- | --- |
| Rotate a secret, or all of them | [Rotate secrets](../guides/rotate-secrets.md) |
| Cut off a user or a tenant now | [Respond to an incident](../guides/respond-to-an-incident.md) |
| Revoke access the normal way, and know how long it takes | [Manage access](../guides/manage-access.md), [Access spec §8.6](../access/spec.md#86-revocation-latency) |
| Review who changed what | [Manage access](../guides/manage-access.md), [Access API: administration](../access/api.md#administration) |
| Harden an Access deployment | [Access operations: hardening](../access/operations.md#hardening) |
| Review a gateway deployment | [Gateway operations: deployment review](../gateway/operations.md#deployment-review) |
| Check an upstream verifies identities correctly | [Upstream identity](../gateway/upstream-identity.md) |
| Report or receive a vulnerability | [SECURITY.md](../../SECURITY.md) |

## Secrets by service

| Service | Its secrets | Where they are described | Where they are rotated |
| --- | --- | --- | --- |
| Gateway | Session secret, identity signing key, OIDC client secret, Access token, upstream TLS client key, metrics and control-plane tokens | [Gateway configuration](../gateway/configuration.md) | [Gateway operations: secrets](../gateway/operations.md#secrets) |
| Access | State secret, secret encryption key, signing key, administration, decision and context tokens, metrics token | [Access configuration](../access/configuration.md), [Access spec §4](../access/spec.md#4-environment) | [Access operations: rotating secrets](../access/operations.md#rotating-secrets) |
| Data | Cursor key, access context credential, the gateway's public identity key, metrics token | [Data configuration: deployment artifacts](../data/configuration.md#deployment-artifacts) | [Data operations: rotating secrets](../data/operations.md#rotating-secrets) |
| Console | Session secret, its Access client secret, platform and per-tenant administration tokens, access context token | [Console operations: credentials it holds](../console/operations.md#credentials-it-holds) | [Console operations: rotating secrets](../console/operations.md#rotating-secrets) |

## Security reviews and open findings

| Service | Review | Open findings |
| --- | --- | --- |
| Gateway | [Gateway security policy](../../packages/gateway/SECURITY.md) | [Gateway internals: known gaps](../gateway/internals.md#known-gaps) |
| Access | [Access internals: security review](../access/internals.md#security-review) | [Access internals: open findings](../access/internals.md#open-findings) |
| Data | [Data internals: review](../data/internals.md#review) | [Data internals: open findings](../data/internals.md#open-findings) |

## When something looks wrong

| Signal | Where to look |
| --- | --- |
| A spike of `403 workspace_forbidden` or denial reasons | [Gateway spec §6.5](../gateway/spec.md#65-denial-reasons-in-metrics), [Access troubleshooting: decisions denied](../access/troubleshooting.md#decisions-denied) |
| Repeated failed sign-ins | [Access spec §5.6](../access/spec.md#56-failed-logins), [Access troubleshooting: failed logins](../access/troubleshooting.md#failed-logins) |
| `403 cross_site_request` from browsers | [Gateway troubleshooting: cross-site guard](../gateway/troubleshooting.md#cross-site-guard) |
| An upstream rejects the identity signature | [Gateway troubleshooting](../gateway/troubleshooting.md#the-upstream-refuses-the-identity-signature), [Upstream identity: failed verification](../gateway/upstream-identity.md#failed-verification) |
| Data answers `401 UNAUTHENTICATED` | [Data troubleshooting](../data/troubleshooting.md#401-unauthenticated) |
| A revoked caller keeps access | [Gateway troubleshooting](../gateway/troubleshooting.md#a-revoked-caller-keeps-access) |
