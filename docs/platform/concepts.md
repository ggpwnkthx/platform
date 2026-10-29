# Concepts

A glossary of the terms you meet across the gateway, Access, Data, the console and the CLI, with the service that owns each one. Use it to decode a word on any page, then follow the link to the section that defines it normatively.

## How to read this glossary

Each row gives a short definition, the service that owns the concept, and the spec section (or reference page) that is authoritative. Where two services use the same word with different scope, the row says so. The definitions here are summaries; when one disagrees with a spec, the spec wins.

## Identity and sign-in

| Term | Meaning | Owner | Defined in |
| --- | --- | --- | --- |
| Caller | Whoever sends a request: a browser, an API client, the console's server or the CLI. Callers are untrusted until the gateway authenticates them. | Gateway | [Gateway spec: terms](../gateway/spec.md#1-terms) |
| Tenant | A customer of the platform. It has exactly one identity provider, its own principals and its own grants, and it can be disabled as a whole. | Access | [Access spec: `tenants`](../access/spec.md#31-tenants) |
| Identity provider | The OIDC provider that knows who a tenant's people are. Access signs callers in there; the gateway, in turn, treats Access as its provider and works with any conforming one. | Access | [Access spec: terms](../access/spec.md#2-terms) |
| Principal | The platform's own record of a person or service (a row of Access's `users` table). In the gateway, the same word means the authenticated caller with its subject, roles and credential source. | Access | [Access spec: terms](../access/spec.md#2-terms), [gateway spec: terms](../gateway/spec.md#1-terms) |
| Subject | The identifier a token is about. Access looks up an external identity by tenant plus the provider's subject, never by e-mail, and the tokens it issues carry the principal as their subject. | Access | [Access spec: mapping key](../access/spec.md#62-mapping-key) |
| Session | Server-side login state. The browser holds only an opaque identifier, so the session can be revoked or expired. The gateway and the console each keep their own. | Gateway, console | [Gateway spec: sessions](../gateway/spec.md#53-sessions), [console spec: sessions](../console/spec.md#3-sessions) |
| Bearer token | A JWT an API client sends in `Authorization`. The gateway checks signature, issuer, audience, expiry and lifetime before accepting it. | Gateway | [Gateway spec: bearer tokens](../gateway/spec.md#54-bearer-tokens) |
| Signed identity | The `x-gateway-*` headers the gateway adds to a forwarded request, signed as a JWS with the deployment's private key. Upstreams verify them with the public key and cannot forge them. | Gateway | [Gateway spec: identity signature](../gateway/spec.md#74-identity-signature), [Upstream identity](../gateway/upstream-identity.md) |

## Routing

| Term | Meaning | Owner | Defined in |
| --- | --- | --- | --- |
| Route | One entry of the gateway's route table: a host and path (and optionally a method) that select a request policy and one or more upstreams. | Gateway | [Gateway spec: configuration file](../gateway/spec.md#3-configuration-file) |
| Upstream | The application behind the gateway that receives a forwarded request. Data is one; your own service can be another. | Gateway | [Gateway spec: proxying](../gateway/spec.md#11-proxying) |
| Shared state | The Redis or PostgreSQL store where gateway replicas keep sessions, rate-limit windows and cached decisions. | Gateway | [Gateway spec: shared state](../gateway/spec.md#125-shared-state) |
| Control plane | `gateway-control`: a separate internal process, never routed through the gateway, that manages sessions and route-table revisions in the shared state. | Gateway | [Gateway spec: control plane](../gateway/spec.md#127-control-plane) |
| Gateway bindings | Data's file that names which gateway routes it trusts and the public key that verifies their identity signatures. | Data | [Data spec: trusted route bindings](../data/spec.md#41-trusted-route-bindings) |

## Access control

| Term | Meaning | Owner | Defined in |
| --- | --- | --- | --- |
| Workspace | The unit of access control and of data isolation. Routes name it with a `{workspaceId}` path placeholder; Data registers it under one tenant. | Data (registry), Access (grants) | [Data spec: workspace registry](../data/spec.md#61-workspace-registry) |
| Permission | A named capability such as `workspace.read`. It travels in the `roles` claim of Access's tokens, and a grant gives it. | Access | [Access spec: `permissions`](../access/spec.md#33-permissions) |
| Role | A tenant's named bundle of permissions, possibly including other roles. A grant can name a role instead of a single permission. Not to be confused with the `roles` claim, which lists permissions. | Access | [Access spec: `roles`](../access/spec.md#36-roles) |
| Group | A set of one tenant's principals. A grant to a group holds for every member. It is unrelated to a provider's `groups` scope. | Access | [Access spec: `groups`](../access/spec.md#35-groups) |
| Grant | The policy itself: a principal or group holds a permission or role on a workspace and route, until it is revoked or expires. | Access | [Access spec: `grants`](../access/spec.md#34-grants) |
| Access decision | Access's yes-or-no answer to `POST /v1/decisions`, asked by the gateway on every route that names a workspace (and on routes that opt in with `accessCheck`). A decision that cannot be computed is a denial. | Access | [Access spec: decisions](../access/spec.md#8-decisions), [gateway spec: workspace access](../gateway/spec.md#6-workspace-access) |
| Access context | The list of capabilities a principal holds for a workspace and route, read by Data and the console. It complements the decision and never replaces it. | Access | [Access spec: access context](../access/spec.md#9-access-context), [Data spec: access context contract](../data/spec.md#5-access-context-contract) |
| Operator | A person who administers Access, a tenant or the whole platform through the administration API, the console or the CLI. | Access | [Access spec: terms](../access/spec.md#2-terms) |
| Platform and tenant credentials | The two kinds of administration credential: a platform credential may act for every tenant, a tenant credential only for its one tenant, and the audit records a tenant credential's operator name (or a credential's fingerprint), never the credential itself. | Access | [Access spec: administration credentials](../access/spec.md#46-administration-credentials) |
| Operator scope | The `console.status`, `console.admin` and `console.platform` keys the console reads from the caller's access context on every page to decide what to show. | Console | [Console spec: operator scope](../console/spec.md#4-operator-scope) |

## Data

| Term | Meaning | Owner | Defined in |
| --- | --- | --- | --- |
| Collection | A table declared by the deployment's manifest and backed by SQL migrations. Clients choose a registered collection key, never a table or SQL. | Data | [Data spec: managed schema](../data/spec.md#71-managed-schema) |
| Record | One row of a collection. The server fills its `id`, scope, author and time fields and its `version`, which starts at 1 and grows with each update. | Data | [Data spec: server-maintained fields](../data/spec.md#72-server-maintained-fields) |
| Policy bundle | The deployment artifact that says, for each permission, which rows and fields of which collection it may read, create, update or delete. No rule means deny. | Data | [Data spec: policies and capabilities](../data/spec.md#81-policies-and-capabilities) |
| Validator (ETag) | A strong hash of a record's canonical bytes. Updates and deletes must send the current one in `If-Match`. | Data | [Data spec: reads and validators](../data/spec.md#94-reads-and-validators) |
| Receipt and idempotency key | Every record creation (`POST /items/{collection}`) carries an `Idempotency-Key`; the answer is a receipt for that key, so a retry returns the same receipt instead of a second record. | Data | [Data spec: creation and idempotency](../data/spec.md#96-creation-and-idempotency) |
| Event | A versioned envelope describing one committed change, written in the same transaction as the change. | Data | [Data spec: domain event envelope](../data/spec.md#113-domain-event-envelope) |
| Subscriber | Trusted server code registered in Data's composition root that receives matching events through the worker, acting as its own Access principal. | Data | [Data spec: trusted subscribers](../data/spec.md#114-trusted-subscribers) |
| Audit | The durable record of who changed what. Access audits administration; Data audits record changes. | Access, Data | [Access spec: `GET /v1/admin/audit`](../access/spec.md#1015-get-v1adminaudit), [Data spec: audit entries](../data/spec.md#112-audit-entries) |

## Tools and repository

| Term | Meaning | Owner | Defined in |
| --- | --- | --- | --- |
| Profile | The CLI's saved description of one deployment: its addresses, workspace and client. | CLI | [CLI spec: profiles](../cli/spec.md#3-profiles) |
| Probes | `GET /healthz` (alive) and `GET /readyz` (able to serve) on the gateway, Access, Data and the console. | Every service | [Operations: probes](operations.md#probes) |
| Compatibility baseline | A pinned revision of this repository whose gateway and Access the current tree must still work with. | Repository | [Internals: compatibility](internals.md#compatibility) |
| Platform version | The single version shared by every workspace, image, binary and spec. | Repository | [Internals: one version](internals.md#one-version) |
