# Security

The trust model across the platform: trust boundaries, who holds which secret, least privilege, and how to report a finding. It is for security reviewers and operators; each service's own rules are linked under [Service security pages](#service-security-pages).

Every item in a service's security review is answered with a fact: a test, a measurement or code.

## Trust boundaries

```text
   caller            gateway              Access                Data
   ──────            ───────              ──────                ────
   untrusted   ──▶   verifies the         verifies the          verifies the
                     caller's identity    tenant provider's     gateway's identity
                     and signs it for     identity and issues   signature and asks
                     the upstream         its own tokens        for the access context
```

Each boundary is crossed with a signature:

| Boundary | Signed | Signed with | Verified with |
| --- | --- | --- | --- |
| Caller → gateway | Caller's token | Tenant provider's key | Provider's public key, discovered via OpenID Connect |
| Gateway → Access | Gateway's token | Tenant credential, or platform token | Access's public key |
| Gateway → Data | Caller identity, in request headers | Gateway deployment's private key | That deployment's public key, in the gateway bindings |

The third boundary matters most. Data **verifies** the identity signature; it never trusts an identity just because the request arrived from the gateway. As long as the signing private key stays inside the gateway's deployment, even a compromised gateway cannot mint an identity that Data accepts.

The console sits outside these boundaries as an ordinary client. It never holds the gateway's identity-signing private key or a database connection, and every refusal it shows comes from a service.

## Secrets

| Secret | Held by | Read by |
| --- | --- | --- |
| Session secret | Gateway | Nobody; the gateway signs the state cookie with it |
| Identity key | Gateway | Data holds its **public** key |
| Token signing key | Access | The gateway verifies tokens with its public key, discovered via OpenID Connect |
| Encryption key | Access | Nobody; encrypts tenants' client secrets |
| Cursor key | Data | Nobody; signs collection page cursors |
| Access context token | Access | Data, from a file |

The console's own credentials (client secret, access context token, administration tokens and session secret) are listed in [console operations: credentials it holds](../console/operations.md#credentials-it-holds).

> [!IMPORTANT]
> Whenever a service can read a secret from a file, the secret is a file, never an environment value. Anything that can read a process's environment can read a secret stored there.

## Published values

The repository publishes the credentials of its examples: the minimum environment of the root, the example of
each service, the fixtures of the development machine and the map of the control plane. A deployment that
keeps one of them holds a credential that everybody knows.

Every service refuses a published value in a production environment, and says which variable it is:

| Service | Rule |
| --- | --- |
| Gateway | Refuses `GATEWAY_SESSION_SECRET`, `GATEWAY_ACCESS_TOKEN`, `GATEWAY_OIDC_CLIENT_SECRET` and `GATEWAY_METRICS_TOKEN` when they are short, are one repeated character, or are a value of the repository |
| Access | Refuses the same, plus the credentials of the access context and the two secrets of the signing and of the encryption |
| Data | Refuses the credential of the access context, the key of the cursors and the passwords of the roles when they are a value of the repository |
| Console | Refuses the client secret, the session secret and the credentials of the administration when they are a value of the repository |
| Control plane | Refuses the map of the example of the deployment |

The test of the platform reads the published files of the repository and asks every service to refuse every
value it publishes: a value that is published and that no service refuses fails the build.

## Least privilege

Each service connects to its database with a role that cannot do another role's work:

| Service | Rule |
| --- | --- |
| Gateway | Refuses to start if its role bypasses tenant isolation, and names the role |
| Access | Refuses to start if its role bypasses isolation, and names the role |
| Data | Separates owner, API, registry, delivery and maintenance roles; API readiness is `503` with administrator credentials |

## Service security pages

| Service | Rules and reviews |
| --- | --- |
| Gateway | [Gateway spec: header policy](../gateway/spec.md#7-header-policy), [Upstream identity](../gateway/upstream-identity.md) |
| Access | [Access operations](../access/operations.md), [Access internals](../access/internals.md) |
| Data | [Data internals](../data/internals.md) |
| Console | [Console operations](../console/operations.md) |

## Reporting a finding

Report vulnerabilities privately as described in [SECURITY.md](../../SECURITY.md), which also lists the supported versions and what happens after a report.
