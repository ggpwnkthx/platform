/**
 * The console, built, against the contracts of the services.
 *
 * The test builds the console with Vite, the way an image is built, and
 * serves the build against two fakes that speak the contracts the
 * console is a client of: Access (the sign-in, the access
 * context, the administration) and the gateway (the data of a
 * workspace). The fakes answer what the contracts say, and they record
 * what the console sent them.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

const ROOT = resolve(import.meta.dir, '..')
const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const PRINCIPAL = '33333333-3333-4333-8333-333333333333'
const CLIENT = 'platform'
const PUBLIC = 'http://console.test'

type App = { fetch: (request: Request) => Promise<Response> }

let app: App
let access: ReturnType<typeof Bun.serve>
let gateway: ReturnType<typeof Bun.serve>
const seen: { idempotencyKeys: string[]; bearers: string[]; adminCalls: string[] } = {
  idempotencyKeys: [],
  bearers: [],
  adminCalls: [],
}
let consoleKeys = ['console.admin', 'console.status']

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }
  const codes = new Map<string, string>()

  access = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const issuer = `http://127.0.0.1:${access.port}`
      if (url.pathname === '/.well-known/openid-configuration') {
        return Response.json({ issuer, authorization_endpoint: `${issuer}/oauth/authorize` })
      }
      if (url.pathname === '/oauth/jwks') return Response.json({ keys: [jwk] })
      if (url.pathname === '/oauth/authorize') {
        expect(url.searchParams.get('code_challenge_method')).toBe('S256')
        const code = crypto.randomUUID()
        codes.set(code, url.searchParams.get('nonce') ?? '')
        const back = new URL(url.searchParams.get('redirect_uri') ?? '')
        back.searchParams.set('code', code)
        back.searchParams.set('state', url.searchParams.get('state') ?? '')
        return Response.redirect(back.toString(), 302)
      }
      if (url.pathname === '/oauth/token') {
        const form = new URLSearchParams(await request.text())
        const nonce = codes.get(form.get('code') ?? '')
        codes.delete(form.get('code') ?? '')
        if (nonce === undefined || !form.get('code_verifier')) {
          return Response.json({ error: 'invalid_grant' }, { status: 400 })
        }
        const sign = (claims: Record<string, unknown>) =>
          new SignJWT(claims)
            .setProtectedHeader({ alg: 'RS256', kid: 'test' })
            .setIssuer(issuer)
            .setAudience(CLIENT)
            .setSubject(PRINCIPAL)
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(privateKey)
        return Response.json({
          access_token: await sign({ tid: 'acme', roles: ['content.reader'] }),
          id_token: await sign({ tid: 'acme', nonce, email: 'alice@acme.test', name: 'Alice' }),
          token_type: 'Bearer',
          expires_in: 300,
        })
      }
      if (url.pathname === '/v1/access-context') {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.tenantId).toBe(TENANT_ID)
        expect(body.routeId).toBe('console')
        return Response.json({
          version: 1,
          allow: consoleKeys.length > 0,
          permissionKeys: consoleKeys,
          validUntil: new Date(Date.now() + 1).toISOString(),
        })
      }
      if (url.pathname.startsWith('/v1/admin/')) {
        seen.adminCalls.push(
          `${request.method} ${url.pathname} ${request.headers.get('authorization')}`
        )
        if (url.pathname === '/v1/admin/tenants') {
          return Response.json({
            tenants: [
              {
                id: TENANT_ID,
                slug: 'acme',
                displayName: 'Acme',
                issuer: 'http://idp.test',
                emailDomain: null,
                clientId: CLIENT,
                autoProvision: false,
                sharedClient: false,
                default: true,
                enabled: true,
                userCount: 1,
                grantCount: 1,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          })
        }
        if (url.pathname === '/v1/admin/grants') {
          return Response.json({
            grants: [
              {
                id: 'g-1',
                tenant: 'acme',
                userId: PRINCIPAL,
                permission: 'content.reader',
                workspaceId: WORKSPACE,
                routeId: 'data-api',
                expiresAt: null,
                revokedAt: null,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            total: 1,
            limit: 200,
            offset: 0,
          })
        }
        if (url.pathname === '/v1/admin/users') {
          return Response.json({ principals: [], total: 0, limit: 50, offset: 0 })
        }
        if (url.pathname === '/v1/admin/groups') {
          return Response.json({ groups: [], total: 0, limit: 50, offset: 0 })
        }
        if (url.pathname === '/v1/admin/audit') {
          return Response.json({ records: [], total: 0, limit: 8, offset: 0 })
        }
      }
      if (url.pathname === '/healthz') return Response.json({ status: 'ok', version: '1.0.0' })
      if (url.pathname === '/readyz') return Response.json({ status: 'ready' })
      return Response.json({ error: 'not_found', message: 'no such path' }, { status: 404 })
    },
  })

  const article = {
    id: '44444444-4444-4444-8444-444444444444',
    version: 1,
    title: 'Launch notes',
    status: 'draft',
  }
  gateway = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/healthz') return Response.json({ status: 'ok', version: '1.0.0' })
      if (url.pathname === '/readyz') return Response.json({ status: 'not-ready' }, { status: 503 })
      const bearer = request.headers.get('authorization') ?? ''
      seen.bearers.push(bearer)
      if (!bearer.startsWith('Bearer ey')) {
        return Response.json({ error: 'unauthenticated', message: 'no token' }, { status: 401 })
      }
      const prefix = `/ws/${WORKSPACE}/v1`
      const collection = {
        key: 'articles',
        label: 'Articles',
        schemaVersion: 'v1',
        actions: ['read', 'create'],
        readableFields: ['status', 'title'],
        writableFields: ['status', 'title'],
        filterableFields: ['status'],
        fields: [
          { name: 'title', type: 'string', required: true, nullable: false, label: 'Title' },
          {
            name: 'status',
            type: 'enum',
            required: false,
            nullable: false,
            enum: ['draft', 'published'],
          },
        ],
        relations: [],
      }
      switch (`${request.method} ${url.pathname}`) {
        case `GET ${prefix}/me`:
          return Response.json({
            data: {
              principalId: PRINCIPAL,
              tenantId: TENANT_ID,
              workspaceId: WORKSPACE,
              workspace: { id: WORKSPACE, slug: 'acme', displayName: 'The Acme workspace' },
              routeId: 'data-api',
              apiVersion: 'v1',
            },
          })
        case `GET ${prefix}/schema`:
          return Response.json({
            data: {
              apiVersion: 'v1',
              schemaVersion: 'v1',
              policyBundleVersion: 'p1',
              collections: [collection],
            },
          })
        case `GET ${prefix}/schema/articles`:
          return Response.json({ data: collection })
        case `GET ${prefix}/items/articles`:
          return Response.json({ data: [article], meta: { limit: 25, nextCursor: null } })
        case `POST ${prefix}/items/articles`: {
          seen.idempotencyKeys.push(request.headers.get('idempotency-key') ?? '')
          const body = (await request.json()) as Record<string, unknown>
          if (body.title === 'too long') {
            return Response.json(
              {
                error: {
                  code: 'VALIDATION_FAILED',
                  message: 'the record is not valid',
                  details: [{ field: 'title', code: 'MAX_LENGTH' }],
                },
                requestId: 'req-1',
              },
              { status: 422 }
            )
          }
          return Response.json({ data: { id: article.id, version: 1 } }, { status: 201 })
        }
        case `GET ${prefix}/items/articles/${article.id}`:
          return Response.json({ data: article }, { headers: { etag: '"sha256:abc"' } })
        case `GET ${prefix}/items/articles/${article.id}/versions`:
          return Response.json(
            { error: { code: 'NOT_FOUND', message: 'no history' }, requestId: 'r' },
            { status: 404 }
          )
      }
      return Response.json(
        { error: { code: 'NOT_FOUND', message: 'not found' }, requestId: 'r' },
        { status: 404 }
      )
    },
  })

  Object.assign(process.env, {
    CONSOLE_ENVIRONMENT: 'production',
    CONSOLE_PUBLIC_URL: PUBLIC,
    CONSOLE_COOKIE_SECURE: 'false',
    CONSOLE_ACCESS_URL: `http://127.0.0.1:${access.port}`,
    CONSOLE_GATEWAY_URL: `http://127.0.0.1:${gateway.port}`,
    CONSOLE_CLIENT_ID: CLIENT,
    CONSOLE_CLIENT_SECRET: 'the-client-secret',
    CONSOLE_SESSION_SECRET: 'a-session-secret-that-is-long-enough-0001',
    CONSOLE_ADMIN_TOKEN: 'the-platform-token-0001',
    CONSOLE_TENANT_ADMIN_TOKENS: JSON.stringify({ acme: 'the-acme-token-00001' }),
    CONSOLE_ACCESS_CONTEXT_TOKEN: 'the-context-token-0001',
    CONSOLE_LOG_LEVEL: 'error',
  })

  const { build } = await import('vite')
  const configFile = resolve(ROOT, 'vite.config.ts')
  await build({ root: ROOT, configFile, mode: 'client', logLevel: 'silent' })
  await build({ root: ROOT, configFile, mode: 'production', logLevel: 'silent' })
  app = ((await import(resolve(ROOT, 'dist/server/index.js'))) as { default: App }).default
}, 120_000)

afterAll(() => {
  access?.stop(true)
  gateway?.stop(true)
})

/** A browser: it keeps the cookies of the console. */
class Browser {
  readonly cookies = new Map<string, string>()

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.cookies.size > 0) {
      headers.set('cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '))
    }
    const response = await app.fetch(
      new Request(`${PUBLIC}${path}`, { ...init, headers, redirect: 'manual' })
    )
    for (const line of response.headers.getSetCookie()) {
      const [pair = ''] = line.split(';')
      const index = pair.indexOf('=')
      const name = pair.slice(0, index)
      const value = pair.slice(index + 1)
      if (value === '' || /max-age=0/i.test(line)) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
    return response
  }

  /** Sends a form, from a page of the console. */
  async post(path: string, fields: Record<string, string>, origin = PUBLIC): Promise<Response> {
    return await this.request(path, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    })
  }

  /** Signs in, the way a browser follows the redirects. */
  async signIn(target = '/'): Promise<Response> {
    const begin = await this.request(`/auth/login?redirect=${encodeURIComponent(target)}`)
    expect(begin.status).toBe(302)
    const atAccess = await fetch(begin.headers.get('location') ?? '', { redirect: 'manual' })
    const back = new URL(atAccess.headers.get('location') ?? '')
    return await this.request(`${back.pathname}${back.search}`)
  }
}

describe('the console', () => {
  test('the probes answer', async () => {
    const health = await app.fetch(new Request(`${PUBLIC}/healthz`))
    expect(await health.json()).toMatchObject({ status: 'ok', service: 'console' })
    const ready = await app.fetch(new Request(`${PUBLIC}/readyz`))
    expect(ready.status).toBe(200)
  })

  test('the overview is a page anybody reads, and it offers the sign-in', async () => {
    const response = await new Browser().request('/')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'")
    const html = await response.text()
    expect(html).toContain('/auth/login')
    expect(html).toMatch(/<script type="module" async="" src="\/static\/client-[^"]+\.js"/)
  })

  test('a page of the data sends a caller without a session to the sign-in', async () => {
    const response = await new Browser().request('/workspaces')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/auth/login?redirect=%2Fworkspaces')
  })

  test('the sign-in brings the caller back, with a session and nothing else', async () => {
    const browser = new Browser()
    const done = await browser.signIn('/workspaces')
    expect(done.status).toBe(302)
    expect(done.headers.get('location')).toBe('/workspaces')
    expect([...browser.cookies.keys()]).toEqual(['console_session'])
    const page = await browser.request('/workspaces')
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('The Acme workspace')
    expect(html).not.toContain('eyJ')
  })

  test('a code that comes back to another browser is refused', async () => {
    const first = new Browser()
    const begin = await first.request('/auth/login')
    const atAccess = await fetch(begin.headers.get('location') ?? '', { redirect: 'manual' })
    const back = new URL(atAccess.headers.get('location') ?? '')
    const other = await new Browser().request(`${back.pathname}${back.search}`)
    expect(other.status).toBe(400)
    expect(await other.text()).toContain('login_state_invalid')
  })

  test('the records are read through the gateway with the token of the caller', async () => {
    const browser = new Browser()
    await browser.signIn()
    seen.bearers.length = 0
    const page = await browser.request(`/workspaces/${WORKSPACE}/collections/articles`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Launch notes')
    expect(seen.bearers.every((bearer) => bearer.startsWith('Bearer ey'))).toBe(true)
  })

  test('a creation carries the key of its form, and a refusal is shown as it is', async () => {
    const browser = new Browser()
    await browser.signIn()
    const path = `/workspaces/${WORKSPACE}/collections/articles/new`
    const created = await browser.post(path, {
      _idempotency: 'form-key-1',
      title: 'Hello',
      status: 'draft',
    })
    expect(created.status).toBe(302)
    expect(created.headers.get('location')).toContain(
      '/records/44444444-4444-4444-8444-444444444444'
    )
    expect(seen.idempotencyKeys).toContain('form-key-1')

    const refused = await browser.post(path, { _idempotency: 'form-key-2', title: 'too long' })
    expect(refused.status).toBe(422)
    const html = await refused.text()
    expect(html).toContain('VALIDATION_FAILED')
    expect(html).toContain('req-1')
    expect(html).toContain('MAX_LENGTH')
  })

  test('a form of another site is refused before it reaches the session', async () => {
    const browser = new Browser()
    await browser.signIn()
    const response = await browser.post('/auth/logout', {}, 'https://evil.example')
    expect(response.status).toBe(403)
    const still = await browser.request('/me')
    expect(still.status).toBe(200)
  })

  test('the administration acts with the credential of the tenant of the operator', async () => {
    const browser = new Browser()
    await browser.signIn()
    const index = await browser.request('/operators')
    expect(index.headers.get('location')).toBe('/operators/tenants/acme')
    seen.adminCalls.length = 0
    const page = await browser.request('/operators/tenants/acme')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Acme')
    expect(seen.adminCalls.length).toBeGreaterThan(0)
    expect(seen.adminCalls.every((call) => call.endsWith('Bearer the-acme-token-00001'))).toBe(true)
    const other = await browser.request('/operators/tenants/globex')
    expect(other.status).toBe(403)
  })

  test('an operator whose keys were revoked is refused at once', async () => {
    const browser = new Browser()
    await browser.signIn()
    consoleKeys = []
    try {
      await Bun.sleep(5)
      const page = await browser.request('/operators/tenants/acme')
      expect(page.status).toBe(403)
    } finally {
      consoleKeys = ['console.admin', 'console.status']
    }
  })

  test('the status names the state of every service, and its detail is for console.status', async () => {
    const anonymous = (await (await new Browser().request('/status/probes')).json()) as {
      overall: string
      detail: boolean
      services: { id: string; state: string; version: string | null }[]
    }
    expect(anonymous.detail).toBe(false)
    expect(anonymous.overall).toBe('degraded')
    expect(anonymous.services.find((service) => service.id === 'gateway')?.state).toBe('degraded')
    expect(anonymous.services.every((service) => service.version === null)).toBe(true)

    const browser = new Browser()
    await browser.signIn()
    const operator = (await (await browser.request('/status/probes')).json()) as typeof anonymous
    expect(operator.detail).toBe(true)
    expect(operator.services.find((service) => service.id === 'access')?.version).toBe('1.0.0')
  })

  test('the status board names every service by its role', async () => {
    const page = await (await new Browser().request('/status')).text()
    for (const name of ['Gateway', 'Access', 'Data', 'Console']) {
      expect(page).toContain(`<h3>${name}</h3>`)
    }
    expect(page).not.toContain('<h3>The gateway</h3>')
    expect(page).not.toContain('<h3>The console</h3>')
  })

  test('the header carries the places of the console, and the foot the two that are always there', async () => {
    const html = await (await new Browser().request('/')).text()
    const header = html.slice(html.indexOf('<nav class="nav"'), html.indexOf('</nav>'))
    expect(header).toContain('>Overview</a>')
    expect(header).not.toContain('>Documentation</a>')
    expect(header).not.toContain('>Status</a>')

    const foot = html.slice(html.lastIndexOf('<nav aria-label="Footer">'))
    expect(foot).toContain('href="/status"')
    expect(foot).toContain('href="/docs"')
  })

  test('the foot marks the place the reader is on', async () => {
    const html = await (await new Browser().request('/status')).text()
    expect(html).toContain('href="/status" aria-current="page"')
  })

  test('the sign-out ends the session', async () => {
    const browser = new Browser()
    await browser.signIn()
    const out = await browser.post('/auth/logout', {})
    expect(out.status).toBe(302)
    const after = await browser.request('/me')
    expect(after.status).toBe(302)
  })
})
