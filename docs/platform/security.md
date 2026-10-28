# The security of the platform

The security model of each service is the one of its specification and
of its own review:

| Workspace | The security model |
| --- | --- |
| `packages/gateway/` | [spec.md](../gateway/spec.md) §7, [the upstream identity](../gateway/upstream-identity.md) |
| `packages/access/` | [security.md](../access/security.md) |
| `packages/data/` | [security.md](../data/security.md) |

This document holds what is **common** to the three: the trust
boundaries of the platform, the way a secret crosses them, and the way
a finding is reported.

## The trust boundaries

```
   the caller          the gateway          the access service      the data service
   ───────────         ───────────          ────────────────      ───────────────
   untrusted     ──▶   verifies the         verifies the          verifies the
                       identity of the      identity of the        signature of the
                       caller, and          provider of a          identity of the
                       signs it for         tenant, and issues     gateway, and
                       the upstream          its own tokens         asks for the
                                                                   access context
```

There are three boundaries, and each of them is a signature:

| Boundary | What is signed | With what | Verified with what |
| --- | --- | --- | --- |
| The caller and the gateway | The token of the caller | The key of the provider of the tenant | The public key of the provider, discovered through OpenID Connect |
| The gateway and the access service | The token of the gateway | The credential of the tenant, or the token of the platform | The public key of the access service |
| The gateway and the data service | The identity of the caller, in the headers of the request | The private key of the deployment of the gateway | The public key of that deployment, in the bindings of the gateway |

The third boundary is the one the merge touches the least and the one
that matters the most: the data service **verifies** the signature of
the identity, and it never trusts the identity because the request came
from the gateway. A gateway that is compromised cannot mint an identity
that the data service accepts, as long as the private key of the
signature stays in the deployment of the gateway.

## The secrets

| Secret | The service that holds it | The service that reads it |
| --- | --- | --- |
| The secret of the sessions | The gateway | Nobody: the gateway signs the state cookie with it |
| The key of the identity | The gateway | The data service holds the **public** key of it |
| The key of the tokens | The access service | The gateway verifies them with the public key, discovered through OpenID Connect |
| The key of the encryption | The access service | Nobody: the access service encrypts the client secrets of the tenants with it |
| The key of the cursors | The data service | Nobody: the data service signs the pages of a collection with it |
| The token of the access context | The access service | The data service reads it from a file |

The rule of the platform is the same for the three services: **a secret
is a file, never a value of the environment**, whenever the service can
read it from a file. A secret that is in the environment of a process
is in the environment of everything that can read the environment of the
process.

## The least privilege

Each service connects to its database with a role that cannot do what
another role can do:

- the gateway refuses to start when its role bypasses the isolation of
  the tenants, and it names the role;
- the access service refuses to start when its role bypasses the
  isolation, and it names the role;
- the data service separates the roles of the owner, of the api, of the
  registry, of the delivery and of the maintenance, and the readiness of
  the api is `503` when it is given the credentials of the
  administrator.

## The reporting of a finding

The security policy of the platform is in [SECURITY.md](../../SECURITY.md).
It names the versions that are supported, the way to report a finding,
and what happens next.
