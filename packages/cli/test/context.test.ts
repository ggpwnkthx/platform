import { describe, expect, test } from 'bun:test'
import { addressOf, resolveContext, workspaceOf } from '../src/domains/context'
import { CliFailure } from '../src/domains/failure'

const PROFILES = {
  current: 'production',
  profiles: {
    production: {
      gatewayUrl: 'https://api.example.com/',
      accessUrl: 'https://access.example.com',
      workspaceId: '11111111-1111-4111-8111-111111111111',
    },
    development: { gatewayUrl: 'http://127.0.0.1:8080' },
  },
}

describe('the context of a command', () => {
  test('the profile of the shell is the current one', () => {
    const context = resolveContext(PROFILES, {})
    expect(context.name).toBe('production')
    expect(context.gatewayUrl).toBe('https://api.example.com/')
  })

  test('a named profile wins over the current one', () => {
    const context = resolveContext(PROFILES, {}, 'development')
    expect(context.name).toBe('development')
    expect(context.gatewayUrl).toBe('http://127.0.0.1:8080')
  })

  test('the environment wins over the profile', () => {
    const context = resolveContext(PROFILES, { PLATFORMCTL_GATEWAY_URL: 'http://other.test' })
    expect(context.gatewayUrl).toBe('http://other.test')
  })

  test('the environment names the profile', () => {
    const context = resolveContext(PROFILES, { PLATFORMCTL_PROFILE: 'development' })
    expect(context.name).toBe('development')
  })

  test('a profile that is not there is the empty one', () => {
    const context = resolveContext(PROFILES, {}, 'nowhere')
    expect(context.gatewayUrl).toBeUndefined()
  })

  test('the secrets are never read from the environment of a profile', () => {
    const context = resolveContext(PROFILES, { PLATFORMCTL_CLIENT_SECRET: 'the-secret' })
    expect(context.clientSecret).toBe('the-secret')
    expect(context.adminToken).toBeUndefined()
  })

  test('the address of a service that is not named is a usage error', () => {
    const context = resolveContext(PROFILES, {}, 'development')
    try {
      addressOf(context, 'accessUrl', 'PLATFORMCTL_ACCESS_URL')
      throw new Error('the address was accepted')
    } catch (error) {
      expect(error).toBeInstanceOf(CliFailure)
      expect((error as CliFailure).exit).toBe(2)
    }
  })

  test('the address of a service loses its last slash', () => {
    const context = resolveContext(PROFILES, {})
    expect(addressOf(context, 'gatewayUrl', 'PLATFORMCTL_GATEWAY_URL')).toBe(
      'https://api.example.com'
    )
  })

  test('the workspace of a command is named by the reader or by the profile', () => {
    const context = resolveContext(PROFILES, {})
    expect(workspaceOf(context)).toBe('11111111-1111-4111-8111-111111111111')
    expect(workspaceOf(context, '22222222-2222-4222-8222-222222222222')).toBe(
      '22222222-2222-4222-8222-222222222222'
    )
  })

  test('a workspace that is not named is a usage error', () => {
    const context = resolveContext(PROFILES, {}, 'development')
    try {
      workspaceOf(context)
      throw new Error('the workspace was accepted')
    } catch (error) {
      expect((error as CliFailure).exit).toBe(2)
    }
  })
})
