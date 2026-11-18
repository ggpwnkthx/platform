import { describe, expect, test } from 'bun:test'
import { contentSecurityPolicy, headersFile, securityHeaders } from '../scripts/headers.ts'

const origins = {
  public: 'https://platform.example.com',
  issuer: 'https://sso.example.com/dex',
  relay: 'wss://relay.example.com',
}

describe('the headers the site is served with', () => {
  test('the policy names the relay and the issuer, and nothing else', () => {
    const policy = contentSecurityPolicy(origins)
    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("script-src 'self'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("base-uri 'none'")
    expect(policy).toContain("form-action 'self'")
    expect(policy).toContain('connect-src')
    expect(policy).toContain('wss://relay.example.com')
    expect(policy).toContain('https://sso.example.com')
    expect(policy).not.toContain('https://platform.example.com')
  })
  test('the issuer and the relay keep only their origin, not their path', () => {
    const policy = contentSecurityPolicy(origins)
    expect(policy).not.toContain('https://sso.example.com/dex')
  })
  test('the headers a CDN is told to send', () => {
    const headers = securityHeaders(origins)
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['Referrer-Policy']).toBe('no-referrer')
    expect(headers['Strict-Transport-Security']).toContain('max-age=31536000')
  })
  test('the file a CDN reads is the headers, per path', () => {
    const file = headersFile(origins)
    expect(file).toContain('/*')
    expect(file).toContain('Content-Security-Policy:')
    expect(file).toContain('X-Content-Type-Options: nosniff')
    expect(file).toContain('/fonts/*')
  })
})
