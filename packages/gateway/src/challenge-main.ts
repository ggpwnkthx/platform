#!/usr/bin/env bun
/**
 * The responder of the challenges of the authority of the certificates.
 *
 * The authority of the certificates asks the deployment to prove that it
 * owns a name: it asks for the answer of a challenge on the plain HTTP of
 * the name, and the answer is the key authorization of the challenge. The
 * responder publishes that answer and answers the request of the
 * authority.
 *
 * The responder is a process of its own because the port it listens on is
 * not the port of the gateway: a deployment whose ingress publishes the
 * plain HTTP of the deployment on a port of its own needs a process that
 * answers on that port, and the process reads the challenges of the
 * authority from the shared state, where the gateway publishes them.
 */

import { startListener } from './platform/bun/listener'
import { certificateStoreOf, connectSharedState } from './runtime/composition'
import { readChallengeEnv } from './runtime/env'

/** The path of a challenge of the authority. */
const CHALLENGE_PATH = /^\/\.well-known\/acme-challenge\/([A-Za-z0-9_-]+)$/

async function main(): Promise<void> {
  const settings = readChallengeEnv(process.env)
  const connection = await connectSharedState({
    url: settings.stateUrl,
    postgres: {
      poolMax: 2,
      connectionTimeoutMs: 5_000,
      statementTimeoutMs: 5_000,
      synchronousCommit: 'off',
      autoMigrate: false,
    },
    onError: (error: unknown) => {
      console.error(
        JSON.stringify({
          level: 'warn',
          msg: 'the shared state of the responder is not reachable',
          error: String(error),
        })
      )
    },
  })
  if (!connection || connection.kind !== 'redis') {
    throw new Error(
      'the responder reads the challenges of the authority from the shared state: GATEWAY_CHALLENGE_STATE_URL has to name a Redis server'
    )
  }
  const store = certificateStoreOf(connection, settings.keyPrefix)

  const listener = startListener({
    host: settings.host,
    port: settings.port,
    app: {
      handle: async (request: Request) => {
        const path = new URL(request.url).pathname
        const match = CHALLENGE_PATH.exec(path)
        if (!match) return new Response('not found', { status: 404 })
        const authorization = await store.challenge(match[1]!)
        if (authorization === null) return new Response('not found', { status: 404 })
        return new Response(authorization, {
          headers: { 'content-type': 'application/octet-stream' },
        })
      },
    },
  })

  console.log(
    JSON.stringify({
      level: 'info',
      msg: 'the responder of the challenges started',
      port: listener.port,
    })
  )

  const stop = (): void => {
    void listener.stop(true).then(async () => {
      await connection.client.close()
      process.exit(0)
    })
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'the responder of the challenges failed to start',
      error: String(error),
    })
  )
  process.exit(1)
})
