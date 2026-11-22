import { readFileSync } from 'node:fs'
import { addressList } from './addresses.ts'

const isLoopback = (host: string) =>
  host === 'localhost' || host === '::1' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host)

/** The relay's options, read from the environment a deployment sets. */
export function relayOptionsFromEnv(env: Record<string, string | undefined> = process.env) {
  const upstream = env.RELAY_UPSTREAM ?? '127.0.0.1:5432'
  const [host, port] = upstream.split(':')
  if (!host || !port) throw new Error(`RELAY_UPSTREAM must be host:port, not ${upstream}`)
  // Unset, the relay checks no origin: the deployment may refuse them somewhere else. `*`
  // says the same thing aloud.
  const named = (env.RELAY_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  if (named.includes('*') && named.length > 1)
    throw new Error('RELAY_ORIGINS is * alone, or a list of origins')
  const origins = named.includes('*') ? [] : named
  const sessions = Number(env.RELAY_SESSIONS_PER_ADDRESS ?? '20')
  if (!Number.isInteger(sessions) || sessions < 1)
    throw new Error('RELAY_SESSIONS_PER_ADDRESS must be a number')
  const perRole = Number(env.RELAY_SESSIONS_PER_ROLE ?? '20')
  if (!Number.isInteger(perRole) || perRole < 1)
    throw new Error('RELAY_SESSIONS_PER_ROLE must be a number')
  const pending = Number(env.RELAY_SESSIONS_LOGGING_IN ?? '64')
  if (!Number.isInteger(pending) || pending < 1)
    throw new Error('RELAY_SESSIONS_LOGGING_IN must be a number')
  const loginSeconds = Number(env.RELAY_LOGIN_SECONDS ?? '30')
  if (!Number.isFinite(loginSeconds) || loginSeconds <= 0)
    throw new Error('RELAY_LOGIN_SECONDS must be a number of seconds')
  const proxies = (env.RELAY_TRUSTED_PROXIES ?? '')
    .split(',')
    .map((block) => block.trim())
    .filter(Boolean)
  // Read here, so that a block that is not one stops the relay before it listens.
  addressList(proxies)
  const upstreamTls = (env.RELAY_UPSTREAM_TLS ?? '').trim().toLowerCase()
  if (!['', 'off', 'verify'].includes(upstreamTls))
    throw new Error('RELAY_UPSTREAM_TLS must be verify or off')
  // The stream carries every reader's token. On this machine it crosses no network; anywhere
  // else, whether it crosses one in the clear is the deployment's to say, not a default.
  if (!upstreamTls && !isLoopback(host))
    throw new Error(
      `RELAY_UPSTREAM_TLS must be set to reach ${host}: verify, or off where the network between the relay and PostgreSQL is one you trust with a token`
    )
  const upstreamCa = env.RELAY_UPSTREAM_CA
  if (upstreamCa && upstreamTls !== 'verify')
    throw new Error('RELAY_UPSTREAM_CA needs RELAY_UPSTREAM_TLS=verify')
  const tlsCert = env.RELAY_TLS_CERT
  const tlsKey = env.RELAY_TLS_KEY
  if (Boolean(tlsCert) !== Boolean(tlsKey))
    throw new Error('RELAY_TLS_CERT and RELAY_TLS_KEY are both needed, or neither')
  return {
    upstream: {
      host,
      port: Number(port),
      ...(upstreamTls === 'verify'
        ? {
            tls: upstreamCa
              ? {
                  // fallow-ignore-next-line security-sink -- the path is the deployment's own, from its environment
                  ca: readFileSync(upstreamCa, 'utf8'),
                }
              : {},
          }
        : {}),
    },
    port: Number(env.RELAY_PORT ?? '8081'),
    allowedOrigins: origins,
    sessionsPerAddress: sessions,
    sessionsPerRole: perRole,
    sessionsLoggingIn: pending,
    loginTimeoutMs: loginSeconds * 1000,
    trustedProxies: proxies,
    ...(tlsCert && tlsKey
      ? {
          tls: {
            // fallow-ignore-next-line security-sink -- the path is the deployment's own, from its environment
            cert: readFileSync(tlsCert, 'utf8'),
            // fallow-ignore-next-line security-sink -- the path is the deployment's own, from its environment
            key: readFileSync(tlsKey, 'utf8'),
          },
        }
      : {}),
  }
}
