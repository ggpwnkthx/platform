import { readFileSync } from 'node:fs'

/**
 * What the relay is told by its environment: where PostgreSQL is, who may open a session,
 * and how many sessions an address, and a role, may hold at once.
 */

export interface RelaySettings {
  upstream: { host: string; port: number; tls?: { ca?: string } }
  port: number
  /** The origins that may open a session. Empty allows any: only with RELAY_ALLOW_ANY_ORIGIN. */
  allowedOrigins: string[]
  tls?: { cert: string; key: string }
  /** How many sessions one client address may hold at once. 0 is no limit. */
  sessionsPerAddress: number
  /** How many sessions one role may hold at once. 0 is no limit. */
  sessionsPerRole: number
}

const isLoopback = (host: string) => /^(localhost|::1|\[::1\]|127(\.\d{1,3}){3})$/.test(host)
const count = (name: string, value: string | undefined) => {
  if (value === undefined || value === '') return 0
  const said = Number(value)
  if (!Number.isInteger(said) || said < 0)
    throw new Error(`${name} must be a number of sessions, or 0 for no limit`)
  return said
}
const yes = (value: string | undefined) =>
  value !== undefined && ['1', 'true', 'yes'].includes(value.trim().toLowerCase())

export function relaySettingsFromEnv(
  env: Record<string, string | undefined> = process.env
): RelaySettings {
  const [host, port] = (env.RELAY_UPSTREAM ?? '127.0.0.1:5432').split(':')
  if (!host || !port) throw new Error('RELAY_UPSTREAM must be host:port')
  const said = (env.RELAY_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin && origin !== '*')
  const anyOrigin = (env.RELAY_ORIGINS ?? '').split(',').some((origin) => origin.trim() === '*')
  const upstreamTls = (env.RELAY_UPSTREAM_TLS ?? '').trim().toLowerCase()
  if (!['', 'off', 'verify'].includes(upstreamTls))
    throw new Error('RELAY_UPSTREAM_TLS must be verify or off')
  // A token must not cross a network in the clear by accident: off is said, never assumed.
  if (!upstreamTls && !isLoopback(host))
    throw new Error(
      `RELAY_UPSTREAM_TLS must be set to reach ${host}: verify, or off where the network between the relay and PostgreSQL is one you trust with a token`
    )
  if (env.RELAY_UPSTREAM_CA && upstreamTls !== 'verify')
    throw new Error('RELAY_UPSTREAM_CA needs RELAY_UPSTREAM_TLS=verify')
  if (Boolean(env.RELAY_TLS_CERT) !== Boolean(env.RELAY_TLS_KEY))
    throw new Error('RELAY_TLS_CERT and RELAY_TLS_KEY are both needed, or neither')
  // An origin that is not checked is a decision, and it is said out loud: a relay that
  // answers the network checks the origin itself, or it does not answer the network.
  if (anyOrigin && !yes(env.RELAY_ALLOW_ANY_ORIGIN))
    throw new Error(
      'RELAY_ORIGINS=* checks no origin: RELAY_ALLOW_ANY_ORIGIN=1 must say that the edge in front of the relay checks it'
    )
  if (!said.length && !yes(env.RELAY_ALLOW_ANY_ORIGIN))
    throw new Error(
      'RELAY_ORIGINS must name the site that may open a session, or RELAY_ALLOW_ANY_ORIGIN=1 must say that the edge in front of the relay checks the origin itself'
    )
  const file = (path: string) => readFileSync(path, 'utf8')
  return {
    upstream: {
      host,
      port: Number(port),
      ...(upstreamTls === 'verify'
        ? { tls: env.RELAY_UPSTREAM_CA ? { ca: file(env.RELAY_UPSTREAM_CA) } : {} }
        : {}),
    },
    port: Number(env.RELAY_PORT ?? '8081'),
    allowedOrigins: said,
    sessionsPerAddress: count('RELAY_SESSIONS_PER_ADDRESS', env.RELAY_SESSIONS_PER_ADDRESS),
    sessionsPerRole: count('RELAY_SESSIONS_PER_ROLE', env.RELAY_SESSIONS_PER_ROLE),
    ...(env.RELAY_TLS_CERT && env.RELAY_TLS_KEY
      ? { tls: { cert: file(env.RELAY_TLS_CERT), key: file(env.RELAY_TLS_KEY) } }
      : {}),
  }
}
