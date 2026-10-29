#!/usr/bin/env bun
/**
 * The keys of a development machine.
 *
 * The gateway signs the identity of every request it forwards, and the
 * Data verifies that signature with the public key of the pair.
 * The two have to hold the same pair, and it has to be the same on every
 * replica of the gateway.
 *
 * The script writes the pair into `deploy/secrets/`:
 *
 *   deploy/secrets/identity-signing.pem          the private key, for the gateway
 *   deploy/secrets/identity-signing.public.pem   the public key, for Data
 *
 * and the bindings of Data for a **run from the source**:
 *
 *   deploy/config/bindings.local.json            the public key, at its local path
 *   deploy/config/routes.local.json              the route table, at the local ports
 *
 * The files are the fixtures of a development machine: they are **not**
 * committed, and they are **not** secrets. A deployment mounts the
 * credentials of its own secret manager.
 *
 *   bun run scripts/dev-keys.ts
 *   export GATEWAY_IDENTITY_SIGNING_KEY="$(cat deploy/secrets/identity-signing.pem)"
 *   docker compose up --build
 */

import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** The curve of the key: P-256, the curve of the `ES256` signature. */
const CURVE = 'prime256v1'

/** The root of the repository. */
const root = resolve(import.meta.dir, '..')

/** The directory of the secrets of the development machine. */
const directory = join(root, 'deploy', 'secrets')

const { privateKey } = generateKeyPairSync('ec', { namedCurve: CURVE })
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString()

await mkdir(directory, { recursive: true })
await writeFile(join(directory, 'identity-signing.pem'), pem)
await writeFile(join(directory, 'identity-signing.public.pem'), publicPem)

// The bindings of Data for a run from the source: the public
// key is at its path on the disk, and not at the path it has in the
// container. The path is absolute: the bindings are read from the
// directory the service runs in, and that directory is not the root of
// the repository.
await writeFile(
  join(root, 'deploy', 'config', 'bindings.local.json'),
  `${JSON.stringify(
    {
      version: 2,
      bindings: [
        {
          id: 'data-api',
          host: 'api.gateway.test',
          upstreamPathPattern: '/ws/{workspaceId}/v1/*',
          routeId: 'data-api',
          identity: {
            version: 'v5',
            algorithm: 'ES256',
            publicKeyFile: join(directory, 'identity-signing.public.pem'),
          },
        },
      ],
    },
    null,
    2
  )}\n`
)

// The route table of the gateway for a run from the source: the upstream
// is Data at its port on the loopback, and not at the name
// it has in the network of the containers.
await writeFile(
  join(root, 'deploy', 'config', 'routes.local.json'),
  `${JSON.stringify(
    {
      version: 1,
      defaults: {
        auth: { mode: 'none' },
        timeouts: { responseMs: 5000, firstByteMs: 30000, bodyMs: 300000 },
        maxBodyBytes: 10485760,
      },
      trustedProxies: ['127.0.0.1/32', '::1/128'],
      routes: [
        {
          id: 'data-api',
          match: { host: 'api.gateway.test', path: '/ws/{workspaceId}/' },
          upstream: 'http://127.0.0.1:8082',
          auth: { mode: 'any', workspace: { param: 'workspaceId', requireUuid: true } },
          websocket: true,
          accessCacheTtlMs: 0,
        },
      ],
    },
    null,
    2
  )}\n`
)

console.log(
  [
    'the pair of the identity signature is written:',
    `  ${join(directory, 'identity-signing.pem')}`,
    `  ${join(directory, 'identity-signing.public.pem')}`,
    `  ${join(root, 'deploy', 'config', 'bindings.local.json')}`,
    `  ${join(root, 'deploy', 'config', 'routes.local.json')}`,
    '',
    'the gateway reads the private key from the environment:',
    '  export GATEWAY_IDENTITY_SIGNING_KEY="$(cat deploy/secrets/identity-signing.pem)"',
  ].join('\n')
)
