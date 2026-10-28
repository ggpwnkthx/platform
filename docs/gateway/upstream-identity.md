# Upstream identity

How an upstream verifies the caller identity the gateway writes and signs into forwarded request headers,
with code. The normative rules are [spec §7.1 and §7.4](spec.md).

## Headers

| Header | Value |
| --- | --- |
| `x-gateway-user` | The caller's subject. |
| `x-gateway-email` | The caller's e-mail address, when known. |
| `x-gateway-roles` | The caller's roles, comma-separated. |
| `x-gateway-workspace` | The caller's workspace, when the route has one. |
| `x-gateway-signature` | The identity signature: `v5=<the compact JWS>`. |

Only the gateway writes these headers; it removes them from client requests. An upstream that trusts them
without verifying the signature is trusting the network.

## Key

The gateway holds the deployment's **private** key; upstreams get the **public** key:

```bash
bun run identity:key              # a new pair
bun run identity:key --public     # the public key of the key in the environment
```

The public key is a PEM P-256 elliptic-curve key, and signatures are `ES256`. Holding the public key lets
an upstream verify an identity but not mint one.

Upstreams never receive the private key or the session secret. There is no other key: the earlier
symmetric format is removed, so the public key is all an upstream holds.

## Verification

1. Read the identity headers and the signature.
2. Rebuild the signature payload from the request and the identity headers.
3. Rebuild the JWS compact serialization around that payload. The payload is **detached**, so the middle
   segment is empty and you insert your own payload.
4. Verify it with the public key.

Verification is **bound to one combination** of version, algorithm and key. There is no fallback between
algorithms, and one combination's signature is never checked with another's key:

| Value version | Protected-header algorithm | Key |
| --- | --- | --- |
| `v5` | `ES256` | The deployment's P-256 public key. |

Refuse:

- an unknown version (`v3`, `v4`, `v6`, empty, …);
- a protected header naming a different algorithm than the version requires;
- a protected header whose type is not `gateway-identity`;
- a key that is not a P-256 public key;
- a malformed compact serialization, or a payload that is not detached (the middle segment must be empty).

The signed values are the header values as received. Do not normalize them before rebuilding the
payload, except as the wire format requires: upper-case the method, lower-case the host, sort the roles.

The payload is a canonical JSON object with fields in this order:

```json
{"v":"v5","method":"GET","path":"/v1/assets","query":"?x=1","host":"api.example.com","subject":"user-1","workspaceId":"…","email":"…","roles":["admin","dev"]}
```

| Field | Value |
| --- | --- |
| `v` | Format version: `v5`. |
| `method` | The method, upper-cased. |
| `path` | The path **as the upstream received it**, after the route's rewrite ([spec §11.1.1](spec.md#1111-path-rewrite)). |
| `query` | The query string as received, with its leading `?`; empty string if none. |
| `host` | The effective host as written in `x-forwarded-host`, lower-cased. |
| `subject` | The caller's subject. |
| `workspaceId` | The workspace, or empty string. |
| `email` | The caller's e-mail, or empty string. |
| `roles` | The caller's roles, sorted ascending. |

The roles are those in `x-gateway-roles`. The gateway drops any role that would make the comma-separated
list ambiguous, so the signature covers exactly the header's roles.

Verification is one standard-library call. The reference implementation,
[examples/upstream-identity/verify.ts](../../packages/gateway/examples/upstream-identity/verify.ts), is
**standalone**: it imports only the `jose` package, nothing from the gateway.

## Code

### TypeScript

```ts
import { importSPKI } from 'jose'
import { verifyIdentity } from './verify'

const key = await importSPKI(publicKeyPem, 'ES256')

const result = await verifyIdentity({
  request: { method: request.method, path: request.path, query: request.query, host: request.headers['x-forwarded-host'] ?? '' },
  headers: {
    'x-gateway-user': request.headers['x-gateway-user'] ?? '',
    'x-gateway-email': request.headers['x-gateway-email'],
    'x-gateway-roles': request.headers['x-gateway-roles'],
    'x-gateway-workspace': request.headers['x-gateway-workspace'],
    'x-gateway-signature': request.headers['x-gateway-signature'],
  },
  publicKey: key,
})

if (!result.ok) {
  // The request did not go through the gateway, or it was tampered with.
  return new Response('forbidden', { status: 403 })
}
const identity = result.identity
```

The reference verifier refuses any signature it does not understand and returns the reason as text, so
logging it shows what was refused. `v5` is the only format the gateway signs, and the verifier checks it
with the deployment's public key.

### Go

```go
import (
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"strings"

	"github.com/go-jose/go-jose/v4"
)

type payload struct {
	V          string   `json:"v"`
	Method     string   `json:"method"`
	Path       string   `json:"path"`
	Query      string   `json:"query"`
	Host       string   `json:"host"`
	Subject    string   `json:"subject"`
	WorkspaceID string  `json:"workspaceId"`
	Email      string   `json:"email"`
	Roles      []string `json:"roles"`
}
```

Rebuild the payload the same way (same field order, sorted roles, header values as received) and verify
with the public key:

```go
object, err := jose.ParseSigned(signature[3:]) // the part after "v5="
if err != nil { return err }
body, err := object.Verify(key)
```

`jose` expects the JWS payload, so restore the detached payload before verifying:
`object.DetachedPayload(canonical)`.

Bind the combination in Go too: read the value's version, refuse unknown versions, and check that the
protected header names `ES256` and type `gateway-identity` before verifying:

```go
if !strings.HasPrefix(signature, "v5=") { return errUnknownVersion }
if len(object.Signatures) != 1 { return errMalformed }
header := object.Signatures[0].Header
if header.Algorithm != "ES256" || header.Type != "gateway-identity" { return errMalformed }
```

## Failed verification

The request did not come through the gateway, or was tampered with. Refuse it with `403`: the identity
cannot be trusted.

The gateway signs every request that carries an identity, so an upstream that requires one never gets an
unsigned request from it. An unauthenticated request is forwarded with neither identity nor signature; the
route decides whether one is required.

## Versions

| Version | Format | Key | State |
| --- | --- | --- | --- |
| `v5` | JWS with detached payload, `ES256`. | The deployment's private key; upstreams hold the public key. | **The only format in `1.0`.** |
| `v4` | Same format, `HS256`. | Derived from the session secret and held by upstreams, so a verifying upstream could also mint identities. | **Removed** in `1.0`. |

The gateway signs only `v5`. Change any upstream that verifies `v4` to read the value's version and verify
with the deployment's public key. The reference verifier does this and refuses `v4` like any other unknown
version.

The gateway's own symmetric support lived in
[src/domains/forwarding/identity.ts](../../packages/gateway/src/domains/forwarding/identity.ts):
`symmetricIdentityKey` and `deriveIdentityKey` built the derived key and signed `v4`. Both were removed with
the format.

## Compatibility

The identity contract is [spec §7.4](spec.md#74-identity-signature). An upstream that implements it works with every gateway
revision that keeps that section. For **evidence**, pin a revision and test your implementation against it.

Stable links follow the release tag (`v1.0.0`); links on `main` describe the next release:

- Specification: [spec.md §7.4](spec.md#74-identity-signature)
- Guide: [upstream-identity.md](upstream-identity.md)
- Reference verifier: [examples/upstream-identity/verify.ts](../../packages/gateway/examples/upstream-identity/verify.ts)

Evidence for a tested baseline uses the **full commit sha**, so links resolve to the tested bytes:

```
https://github.com/ggpwnkthx/platform/blob/<commit-sha>/docs/gateway/spec.md#74-identity-signature
https://github.com/ggpwnkthx/platform/blob/<commit-sha>/packages/gateway/examples/upstream-identity/verify.ts
https://github.com/ggpwnkthx/platform/blob/<commit-sha>/packages/gateway/examples/upstream-identity/verify.test.ts
```

The verifier's tests are the format's contract test: they sign with the gateway's real signer and verify
with the reference implementation, so any change to payload, version or algorithm fails the gateway build.
Run the same check against your implementation with your own fixtures.

This guide was tested at revision `39ece6a6682e41eee114b2cd7560728d438d564a`: spec, guide, reference
verifier and tests are those of that commit.

The access-service protocol, the other contract between the gateway and its neighbours, has its own
conformance suite:
[test/support/access-conformance.ts](../../packages/gateway/test/support/access-conformance.ts). It is
parameterized by a profile naming the subjects and workspaces an implementation knows, so an access service
can run it against itself. It is integration guidance, not a gateway runtime dependency.
