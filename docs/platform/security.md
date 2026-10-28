# Security

The platform-wide security model: trust boundaries, who holds which secret, least privilege, and how to report a finding. Service-specific rules and reviews: gateway [spec](../gateway/spec.md) §7 and [upstream identity](../gateway/upstream-identity.md); access service [operations](../access/operations.md) and [internals](../access/internals.md); data service [internals](../data/internals.md); [console operations](../console/operations.md).

Every item in a service's security review is answered with a fact: a test, a measurement or code.

## Trust boundaries

```
   caller            gateway              access service        data service
   ──────            ───────              ──────────────        ────────────
   untrusted   ──▶   verifies the         verifies the          verifies the
                     caller's identity    tenant provider's     gateway's identity
                     and signs it for     identity and issues   signature and asks
                     the upstream         its own tokens        for the access context
```

Each boundary is a signature:

| Boundary | Signed | Signed with | Verified with |
| --- | --- | --- | --- |
| Caller → gateway | Caller's token | Tenant provider's key | Provider's public key, discovered via OpenID Connect |
| Gateway → access service | Gateway's token | Tenant credential, or platform token | Access service's public key |
| Gateway → data service | Caller identity, in request headers | Gateway deployment's private key | That deployment's public key, in the gateway bindings |

The third boundary matters most: the data service **verifies** the identity signature and never trusts an identity because the request came from the gateway. A compromised gateway cannot mint an identity the data service accepts, as long as the signing private key stays in the gateway's deployment.

## Secrets

| Secret | Held by | Read by |
| --- | --- | --- |
| Session secret | Gateway | Nobody; the gateway signs the state cookie with it |
| Identity key | Gateway | The data service holds its **public** key |
| Token signing key | Access service | The gateway verifies tokens with its public key, discovered via OpenID Connect |
| Encryption key | Access service | Nobody; encrypts tenants' client secrets |
| Cursor key | Data service | Nobody; signs collection page cursors |
| Access context token | Access service | The data service, from a file |

> [!IMPORTANT]
> A secret is a file, never an environment value, whenever the service can read it from a file. Anything that can read a process's environment can read a secret stored there.

## Least privilege

Each service connects to its database with a role that cannot do another role's work:

| Service | Rule |
| --- | --- |
| Gateway | Refuses to start if its role bypasses tenant isolation, and names the role |
| Access service | Refuses to start if its role bypasses isolation, and names the role |
| Data service | Separates owner, API, registry, delivery and maintenance roles; API readiness is `503` with administrator credentials |

## Reporting a finding

See [SECURITY.md](../../SECURITY.md): supported versions, how to report, and what happens next.
