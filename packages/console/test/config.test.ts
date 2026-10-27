import { describe, expect, test } from 'bun:test'
import { ConfigError, readConfig } from '../src/runtime/config'

const BASE = {
  CONSOLE_PUBLIC_URL: 'https://console.example.com',
  CONSOLE_ACCESS_URL: 'http://access.internal:8081/',
  CONSOLE_GATEWAY_URL: 'http://api.gateway.test:8080',
  CONSOLE_CLIENT_ID: 'platform',
  CONSOLE_CLIENT_SECRET: 'the-client-secret',
  CONSOLE_SESSION_SECRET: 'a-session-secret-that-is-long-enough-0001',
}

describe('the configuration of the console', () => {
  test('a minimal environment is a production console', () => {
    const config = readConfig(BASE)
    expect(config.environment).toBe('production')
    expect(config.port).toBe(8083)
    expect(config.accessUrl).toBe('http://access.internal:8081')
    expect(config.cookieSecure).toBe(true)
    expect(config.routeId).toBe('console')
    expect(config.dataUrl).toBeNull()
    expect(config.adminToken).toBeNull()
  })

  test('an empty value is an absent value', () => {
    const config = readConfig({ ...BASE, CONSOLE_DATA_URL: '', CONSOLE_ADMIN_TOKEN: '  ' })
    expect(config.dataUrl).toBeNull()
    expect(config.adminToken).toBeNull()
  })

  test('every problem is named at once', () => {
    try {
      readConfig({ CONSOLE_PORT: 'eighty', CONSOLE_SESSION_SECRET: 'short' })
      throw new Error('the configuration was accepted')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const problems = (error as ConfigError).problems.join('\n')
      expect(problems).toContain('CONSOLE_PUBLIC_URL is required')
      expect(problems).toContain('CONSOLE_ACCESS_URL is required')
      expect(problems).toContain('CONSOLE_CLIENT_SECRET is required')
      expect(problems).toContain('CONSOLE_SESSION_SECRET is shorter than 32 characters')
      expect(problems).toContain('CONSOLE_PORT')
    }
  })

  test('a production console in the clear has to say so', () => {
    expect(() => readConfig({ ...BASE, CONSOLE_PUBLIC_URL: 'http://console.example.com' })).toThrow(
      ConfigError
    )
    const accepted = readConfig({
      ...BASE,
      CONSOLE_PUBLIC_URL: 'http://console.example.com',
      CONSOLE_COOKIE_SECURE: 'false',
    })
    expect(accepted.cookieSecure).toBe(false)
  })

  test('the credentials of the tenants are a json object of slugs', () => {
    const config = readConfig({
      ...BASE,
      CONSOLE_TENANT_ADMIN_TOKENS: JSON.stringify({ acme: 'the-token-of-acme-0001' }),
    })
    expect(config.tenantAdminTokens).toEqual({ acme: 'the-token-of-acme-0001' })
    expect(() =>
      readConfig({ ...BASE, CONSOLE_TENANT_ADMIN_TOKENS: JSON.stringify({ Acme: 'short' }) })
    ).toThrow(ConfigError)
    expect(() => readConfig({ ...BASE, CONSOLE_TENANT_ADMIN_TOKENS: '[1]' })).toThrow(ConfigError)
  })

  test('a credential shorter than the rule of the access service is refused', () => {
    expect(() => readConfig({ ...BASE, CONSOLE_ADMIN_TOKEN: 'too-short' })).toThrow(ConfigError)
  })
})
