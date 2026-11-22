import { describe, expect, test } from 'bun:test'
import { relayOptionsFromEnv, startupPacketIn } from '../src/relay.ts'
import { int32, startupPacket } from './relay-helpers.ts'

/**
 * The first packet of a session, and the options a deployment sets.
 */

describe('the first packet of a session', () => {
  test('is a startup packet of protocol 3, whole or not yet', () => {
    const packet = startupPacket('alice@example.com')
    expect(startupPacketIn(packet)).toBe('whole')
    expect(startupPacketIn(packet.subarray(0, 4))).toBe('partial')
    expect(startupPacketIn(packet.subarray(0, packet.length - 1))).toBe('partial')
    // Protocol 3.2, as libpq 18 may ask for it.
    expect(startupPacketIn(Buffer.concat([int32(9), int32(196610), Buffer.alloc(1)]))).toBe('whole')
  })

  test('is nothing else: no request for TLS, no cancel, no length PostgreSQL would not read', () => {
    expect(startupPacketIn(Buffer.concat([int32(8), int32(80877103)]))).toBe('refused')
    expect(startupPacketIn(Buffer.concat([int32(8), int32(80877104)]))).toBe('refused')
    expect(startupPacketIn(Buffer.concat([int32(16), int32(80877102)]))).toBe('refused')
    expect(startupPacketIn(Buffer.concat([int32(10001), int32(196608)]))).toBe('refused')
    expect(startupPacketIn(Buffer.concat([int32(4), int32(196608)]))).toBe('refused')
    expect(startupPacketIn(Buffer.concat([int32(-1), int32(196608)]))).toBe('refused')
  })
})
describe('the options a deployment sets', () => {
  const env = {
    RELAY_UPSTREAM: 'postgres:5432',
    RELAY_UPSTREAM_TLS: 'off',
    RELAY_ORIGINS: 'https://platform.example.com/',
  }

  test('have defaults that keep a login short and counted', () => {
    const options = relayOptionsFromEnv(env)
    expect(options.sessionsLoggingIn).toBe(64)
    expect(options.loginTimeoutMs).toBe(30000)
    expect(options.trustedProxies).toEqual([])
    expect(options.upstream).toEqual({ host: 'postgres', port: 5432 })
    expect(options.allowedOrigins).toEqual(['https://platform.example.com'])
  })

  test('check no origin when the deployment names none, or says any', () => {
    expect(relayOptionsFromEnv({ ...env, RELAY_ORIGINS: undefined }).allowedOrigins).toEqual([])
    expect(relayOptionsFromEnv({ ...env, RELAY_ORIGINS: '*' }).allowedOrigins).toEqual([])
    expect(() => relayOptionsFromEnv({ ...env, RELAY_ORIGINS: '*, https://a.example' })).toThrow(
      'alone'
    )
  })

  test('reach a PostgreSQL on another machine in the clear only when the deployment says so', () => {
    const elsewhere = { ...env, RELAY_UPSTREAM_TLS: undefined }
    expect(() => relayOptionsFromEnv(elsewhere)).toThrow('RELAY_UPSTREAM_TLS')
    // On this machine the stream crosses no network.
    for (const here of ['127.0.0.1:5432', 'localhost:5432'])
      expect(relayOptionsFromEnv({ ...elsewhere, RELAY_UPSTREAM: here }).upstream.tls).toBe(
        undefined
      )
  })

  test('name the proxies to believe and ask for TLS to PostgreSQL', () => {
    const options = relayOptionsFromEnv({
      ...env,
      RELAY_TRUSTED_PROXIES: '10.0.0.0/8, 192.168.1.1',
      RELAY_UPSTREAM_TLS: 'verify',
      RELAY_LOGIN_SECONDS: '10',
    })
    expect(options.trustedProxies).toEqual(['10.0.0.0/8', '192.168.1.1'])
    expect(options.upstream).toEqual({ host: 'postgres', port: 5432, tls: {} })
    expect(options.loginTimeoutMs).toBe(10000)
  })

  test('refuse what they cannot mean', () => {
    expect(() => relayOptionsFromEnv({ ...env, RELAY_TRUSTED_PROXIES: 'ingress' })).toThrow('CIDR')
    expect(() => relayOptionsFromEnv({ ...env, RELAY_UPSTREAM_TLS: 'maybe' })).toThrow('verify')
    expect(() => relayOptionsFromEnv({ ...env, RELAY_UPSTREAM_CA: '/ca.pem' })).toThrow('verify')
    expect(() => relayOptionsFromEnv({ ...env, RELAY_LOGIN_SECONDS: '0' })).toThrow('seconds')
  })
})
