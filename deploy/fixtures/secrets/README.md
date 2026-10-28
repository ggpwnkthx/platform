# The secrets of the development machine

The files of this directory are the fixtures of a development machine.
They are **committed on purpose**, and they are **not secrets**: anyone
who reads the repository knows their values. A deployment mounts the
credentials of its own secret manager, and it never writes them in an
image, in a file of the repository or in a variable of the
environment.

| File | What it holds |
| --- | --- |
| `access-context.token` | The credential of the deployment at the access service of the access context contract. |
| `cursor.key` | The key that signs the cursors of the pages. At least 32 bytes, and it is not a key of the gateway. |
| `identity.public.pem` | The **public** key of the gateway of the machine. The private key of the pair is not in the repository: the gateway of the machine holds it, and it is generated with the script of the root (`bun run scripts/dev-keys.ts`). |
| `identity.key` | The **legacy** derived key of the gateway (`HS256`). It is a signing capable secret, and it belongs inside the trust boundary of the gateway. The legacy format is refused by default and it is removed in the version `2.0.0` of the platform. |

The token of the metrics endpoint is deliberately **not** here: without
the file of the token the endpoint is absent and it answers `404`. A
developer who wants it writes the file and points
`DATA_METRICS_TOKEN_FILE` at it.

The directory is mounted read only at `/run/secrets` by
[the stacks of the development machine](../../compose/platform.compose.yaml)
and by the continuous integration. The bindings that name the public key
of the gateway are in [`../bindings.json`](../bindings.json).
