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
/** A workspace whose answer does not come in time, and one whose Data is down. */
const SLOW_WORKSPACE = '77777777-7777-4777-8777-777777777777'
const DOWN_WORKSPACE = '88888888-8888-4888-8888-888888888888'
/** The workspace the fake of Data answers a creation with. */
const CREATED_WORKSPACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const PRINCIPAL = '33333333-3333-4333-8333-333333333333'
const CLIENT = 'platform'
const PUBLIC = 'http://console.test'

type App = { fetch: (request: Request) => Promise<Response> }

let app: App
let access: ReturnType<typeof Bun.serve>
let gateway: ReturnType<typeof Bun.serve>
const seen: {
  idempotencyKeys: string[]
  bearers: string[]
  adminCalls: string[]
  contextChecks: string[]
  refreshes: string[]
} = {
  idempotencyKeys: [],
  bearers: [],
  adminCalls: [],
  contextChecks: [],
  refreshes: [],
}
/** The life of the first token of the login, in seconds. */
let firstTokenLives = 300
let consoleKeys = ['console.admin', 'console.status']

/** What the fake Access holds of the administration of acme. */
const policy = {
  grants: [] as Record<string, unknown>[],
  roles: [] as Record<string, unknown>[],
  groups: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
  writes: [] as { method: string; path: string; body: unknown }[],
}

function resetPolicy() {
  policy.writes.length = 0
  policy.users = [ALICE]
  policy.grants = [
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
  ]
  policy.roles = [
    {
      id: 'r-reader',
      tenant: 'acme',
      key: 'reader',
      displayName: 'Readers',
      description: null,
      permissions: ['content.read'],
      roles: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'r-editor',
      tenant: 'acme',
      key: 'editor',
      displayName: 'Editors',
      description: null,
      permissions: ['content.write'],
      roles: ['reader'],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]
  policy.groups = [
    {
      id: 'grp-1',
      tenant: 'acme',
      key: 'team',
      displayName: 'The team',
      members: ['user-alice'],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]
}
const ALICE = {
  id: PRINCIPAL,
  tenant: 'acme',
  externalSubject: 'user-alice',
  email: 'alice@acme.test',
  displayName: 'Alice',
  status: 'active',
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}
resetPolicy()

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
        const sign = (claims: Record<string, unknown>, life: string) =>
          new SignJWT(claims)
            .setProtectedHeader({ alg: 'RS256', kid: 'test' })
            .setIssuer(issuer)
            .setAudience(CLIENT)
            .setSubject(PRINCIPAL)
            .setIssuedAt()
            .setExpirationTime(life)
            .sign(privateKey)
        // The renewal of the console: the refresh token of the login is
        // exchanged for new tokens, and the answer holds a new one.
        if (form.get('grant_type') === 'refresh_token') {
          seen.refreshes.push(form.get('refresh_token') ?? '')
          return Response.json({
            access_token: await sign({ tid: 'acme', roles: ['content.reader'] }, '5m'),
            id_token: await sign({ tid: 'acme', email: 'alice@acme.test', name: 'Alice' }, '5m'),
            token_type: 'Bearer',
            expires_in: 300,
            refresh_token: 'the-refresh-token-of-the-renewal',
          })
        }
        const nonce = codes.get(form.get('code') ?? '')
        codes.delete(form.get('code') ?? '')
        if (nonce === undefined || !form.get('code_verifier')) {
          return Response.json({ error: 'invalid_grant' }, { status: 400 })
        }
        return Response.json({
          access_token: await sign({ tid: 'acme', roles: ['content.reader'] }, '5m'),
          id_token: await sign(
            { tid: 'acme', nonce, email: 'alice@acme.test', name: 'Alice' },
            '5m'
          ),
          token_type: 'Bearer',
          expires_in: firstTokenLives,
          refresh_token: 'the-refresh-token-of-the-login',
        })
      }
      if (url.pathname === '/v1/access-context') {
        const body = (await request.json()) as Record<string, unknown>
        expect(body.tenantId).toBe(TENANT_ID)
        if (body.routeId !== 'console') {
          seen.contextChecks.push(`${body.subject} ${body.workspaceId} ${body.routeId}`)
          return Response.json({
            version: 1,
            allow: true,
            permissionKeys: ['content.read', 'content.write'],
            validUntil: new Date(Date.now() + 1).toISOString(),
          })
        }
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
        // A page of a list: the rows the query asks for, and the number
        // of all of them (Access spec §10.1).
        const page = (key: string, rows: unknown[]) => {
          const limit = Number(url.searchParams.get('limit') ?? 50)
          const offset = Number(url.searchParams.get('offset') ?? 0)
          return Response.json({
            [key]: rows.slice(offset, offset + limit),
            total: rows.length,
            limit,
            offset,
          })
        }
        const write = async () => {
          const body = await request.json()
          policy.writes.push({ method: request.method, path: url.pathname, body })
          return body as Record<string, unknown>
        }
        if (url.pathname === '/v1/admin/grants' && request.method === 'GET') {
          const live = url.searchParams.get('live')
          return page(
            'grants',
            policy.grants.filter((grant) =>
              live === 'true'
                ? !grant.revokedAt
                : live === 'false'
                  ? Boolean(grant.revokedAt)
                  : true
            )
          )
        }
        if (url.pathname === '/v1/admin/grants' && request.method === 'PUT') {
          const body = await write()
          const grant = {
            id: `g-${policy.grants.length + 1}`,
            permission: null,
            role: null,
            revokedAt: null,
            createdAt: '2026-02-01T00:00:00.000Z',
            ...body,
          }
          policy.grants.push(grant)
          return Response.json(grant)
        }
        if (url.pathname.startsWith('/v1/admin/grants/') && request.method === 'DELETE') {
          policy.writes.push({ method: 'DELETE', path: url.pathname, body: null })
          return new Response(null, { status: 204 })
        }
        if (url.pathname === '/v1/admin/users' && request.method === 'POST') {
          const body = await write()
          return Response.json({ ...ALICE, ...body })
        }
        if (url.pathname === '/v1/admin/users') {
          return page('principals', policy.users)
        }
        if (url.pathname === '/v1/admin/groups' && request.method === 'GET') {
          const key = url.searchParams.get('key')
          return page(
            'groups',
            policy.groups.filter((group) => !key || group.key === key)
          )
        }
        if (url.pathname === '/v1/admin/groups' && request.method === 'POST') {
          const body = await write()
          return Response.json({ ...policy.groups[0], ...body })
        }
        if (url.pathname === '/v1/admin/roles' && request.method === 'GET') {
          const key = url.searchParams.get('key')
          return page(
            'roles',
            policy.roles.filter((role) => !key || role.key === key)
          )
        }
        if (url.pathname === '/v1/admin/roles' && request.method === 'PUT') {
          const body = await write()
          const role = { id: `r-${body.key}`, createdAt: '2026-02-01T00:00:00.000Z', ...body }
          policy.roles = [...policy.roles.filter((entry) => entry.key !== body.key), role]
          return Response.json(role)
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
      const down = () =>
        Response.json(
          { error: { code: 'UNAVAILABLE', message: 'not now' }, requestId: 'r' },
          { status: 503 }
        )
      if (url.pathname.startsWith(`/ws/${DOWN_WORKSPACE}/`)) return down()
      if (url.pathname.startsWith(`/ws/${SLOW_WORKSPACE}/`)) {
        await Bun.sleep(4000)
        return down()
      }
      // The creation of a workspace is a call of the tenant: its path
      // names no workspace (Data spec §9.11).
      if (url.pathname === '/v1/workspaces' && request.method === 'POST') {
        const body = (await request.json()) as Record<string, unknown>
        return Response.json(
          {
            data: {
              id: CREATED_WORKSPACE,
              tenantId: TENANT_ID,
              slug: body.slug,
              displayName: body.displayName,
              status: 'active',
            },
          },
          { status: 201 }
        )
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

  /** Sends a form, from a page of the console. A field that repeats is sent as pairs. */
  async post(
    path: string,
    fields: Record<string, string> | readonly (readonly [string, string])[],
    origin = PUBLIC
  ): Promise<Response> {
    const body = new URLSearchParams()
    for (const [name, value] of Array.isArray(fields) ? fields : Object.entries(fields)) {
      body.append(name, value)
    }
    return await this.request(path, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
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

  test('the token of the caller is renewed before it dies', async () => {
    // The token of the login lives one second: the console renews it
    // before it dies, and the caller reads the data without signing in
    // again.
    firstTokenLives = 1
    seen.refreshes.length = 0
    try {
      const browser = new Browser()
      await browser.signIn()
      const page = await browser.request(`/workspaces/${WORKSPACE}/collections/articles`)
      expect(page.status).toBe(200)
      expect(await page.text()).toContain('Launch notes')
      expect(seen.refreshes).toEqual(['the-refresh-token-of-the-login'])
    } finally {
      firstTokenLives = 300
    }
  })

  test('the browser asks the console to renew the token, and it answers when it ends', async () => {
    const browser = new Browser()
    await browser.signIn()
    const answer = await browser.post('/auth/renew', {})
    expect(answer.status).toBe(200)
    const text = await answer.text()
    const body = JSON.parse(text) as Record<string, unknown>
    expect(typeof body.expiresAt).toBe('number')
    expect(body.renewable).toBe(true)
    // The answer holds no token: the browser never sees one.
    expect(text).not.toContain('eyJ')
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

  test('an action the caller may not take is drawn disabled, with its reason', async () => {
    const browser = new Browser()
    await browser.signIn()
    const html = await (
      await browser.request(
        `/workspaces/${WORKSPACE}/collections/articles/records/44444444-4444-4444-8444-444444444444`
      )
    ).text()
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('do not let you delete records of Articles')
    expect(html).toContain('You cannot change this record')
    expect(html).toContain(`href="/workspaces/${WORKSPACE}/access#articles"`)
  })

  test('the access of a workspace is a grid, with the reasons of every no', async () => {
    const browser = new Browser()
    await browser.signIn()
    seen.contextChecks.length = 0
    const html = await (await browser.request(`/workspaces/${WORKSPACE}/access`)).text()
    expect(html).toContain('Your access')
    expect(html).toContain('id="articles"')
    expect(html).toContain('do not let you change records of Articles')
    expect(html).toContain('id="c-articles-why-1"')
    expect(html).toContain('<code>content.write</code>')
    expect(seen.contextChecks).toEqual([`${PRINCIPAL} ${WORKSPACE} data-api`])
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

  test('a capability of the platform is not the one of a tenant operator to give', async () => {
    resetPolicy()
    consoleKeys = ['console.admin', 'console.status']
    const browser = new Browser()
    await browser.signIn()
    const fields = {
      _action: 'grant',
      _form: 'grant',
      back: '/operators/tenants/acme/rights',
      holder: `user:${PRINCIPAL}`,
      kind: 'permission',
      permission: 'console.platform',
      workspace: 'one',
      workspaceId: 'acme',
      routeId: 'console',
      expires: 'never',
    }
    const refused = await browser.post('/operators/tenants/acme/rights', fields)
    expect(refused.status).toBe(302)
    // Nothing was written: the capability of the platform is the
    // platform's, and the operator of a tenant does not hold it.
    expect(policy.writes).toEqual([])
    const again = await (await browser.request('/operators/tenants/acme/rights')).text()
    expect(again).toContain('not yours to give')
  })

  test('an operator of the platform gives the capability of the platform', async () => {
    resetPolicy()
    consoleKeys = ['console.platform', 'console.status']
    const browser = new Browser()
    await browser.signIn()
    seen.adminCalls.length = 0
    await browser.post('/operators/tenants/acme/rights', {
      _action: 'grant',
      _form: 'grant',
      back: '/operators/tenants/acme/rights',
      holder: `user:${PRINCIPAL}`,
      kind: 'permission',
      permission: 'console.platform',
      workspace: 'one',
      workspaceId: 'acme',
      routeId: 'console',
      expires: 'never',
    })
    expect(policy.writes.map((entry) => entry.body)).toEqual([
      expect.objectContaining({ permission: 'console.platform', workspaceId: 'acme' }),
    ])
    // The write is signed with the credential of the platform: the
    // credential of a tenant may not write it.
    const write = seen.adminCalls.find((call) => call.startsWith('PUT /v1/admin/grants '))
    expect(write).toContain('Bearer the-platform-token-0001')
    consoleKeys = ['console.admin', 'console.status']
  })

  test('a role of a tenant operator may not hold a capability of the platform', async () => {
    resetPolicy()
    consoleKeys = ['console.admin', 'console.status']
    const browser = new Browser()
    await browser.signIn()
    await browser.post('/operators/tenants/acme/roles', {
      _action: 'save',
      key: 'platform',
      permissions: 'console.platform',
    })
    // Nothing was written: the capability of the platform is the
    // platform's, and the operator of a tenant does not hold it.
    expect(policy.writes).toEqual([])
    const page = await (await browser.request('/operators/tenants/acme/roles')).text()
    expect(page).toContain('not yours to give')
  })

  test('the rights page names a role grant once, with what the role holds', async () => {
    resetPolicy()
    policy.grants.push({
      id: 'g-role',
      tenant: 'acme',
      group: 'team',
      permission: null,
      role: 'editor',
      workspaceId: null,
      routeId: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const browser = new Browser()
    await browser.signIn()
    const html = await (await browser.request('/operators/tenants/acme/rights')).text()
    expect(html).toContain('content.read, content.write')
    expect(html).not.toContain('through the role editor')
    expect(html).toContain('href="/operators/tenants/acme/groups/team"')
    expect(html).toContain('will hold')
    const filtered = await (
      await browser.request('/operators/tenants/acme/rights?holder=alice')
    ).text()
    expect(filtered).toContain('content.reader')
    expect(filtered).not.toContain('g-role')
  })

  test('a permission nobody names is not created until the operator confirms it', async () => {
    resetPolicy()
    const browser = new Browser()
    await browser.signIn()
    const fields = {
      _action: 'grant',
      _form: 'grant',
      back: '/operators/tenants/acme/rights',
      holder: `user:${PRINCIPAL}`,
      kind: 'permission',
      permission: 'content.raed',
      workspace: 'all',
      routeId: '',
      expires: 'never',
    }
    const refused = await browser.post('/operators/tenants/acme/rights', fields)
    expect(refused.status).toBe(302)
    expect(policy.writes).toEqual([])
    const again = await (await browser.request('/operators/tenants/acme/rights')).text()
    expect(again).toContain('Check the spelling')
    expect(again).toContain('value="content.raed"')

    await browser.post('/operators/tenants/acme/rights', { ...fields, createPermission: 'yes' })
    expect(policy.writes.map((entry) => entry.body)).toEqual([
      expect.objectContaining({ userId: PRINCIPAL, permission: 'content.raed', workspaceId: null }),
    ])
  })

  test('a role key written as a permission is refused, and a role is granted as a role', async () => {
    resetPolicy()
    const browser = new Browser()
    await browser.signIn()
    const fields = {
      _action: 'grant',
      _form: 'grant',
      back: '/operators/tenants/acme/groups/team',
      holder: 'group:team',
      kind: 'permission',
      permission: 'editor',
      workspace: 'one',
      workspaceId: WORKSPACE,
      routeId: 'data-api',
      expires: '7d',
    }
    await browser.post('/operators/tenants/acme/rights', fields)
    expect(policy.writes).toEqual([])
    await browser.post('/operators/tenants/acme/rights', {
      ...fields,
      kind: 'role',
      role: 'editor',
    })
    const body = policy.writes[0]?.body as Record<string, unknown>
    expect(body).toMatchObject({ group: 'team', role: 'editor', workspaceId: WORKSPACE })
    expect(body.permission).toBeUndefined()
    expect(Date.parse(String(body.expiresAt))).toBeGreaterThan(Date.now() + 6 * 86_400_000)
  })

  test('a user page shows what the user can do, and checks a workspace with Access', async () => {
    resetPolicy()
    policy.grants.push({
      id: 'g-role',
      tenant: 'acme',
      group: 'team',
      permission: null,
      role: 'editor',
      workspaceId: null,
      routeId: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const browser = new Browser()
    await browser.signIn()
    seen.contextChecks.length = 0
    const html = await (
      await browser.request(
        `/operators/tenants/acme/users/${PRINCIPAL}?workspace=${WORKSPACE}&route=data-api`
      )
    ).text()
    expect(html).toContain('What Alice can do')
    expect(html).toContain('role editor → reader')
    expect(seen.contextChecks).toEqual([`${PRINCIPAL} ${WORKSPACE} data-api`])
    expect(html).toContain('allowed')
  })

  test('a role is created once, and edited on its own page', async () => {
    resetPolicy()
    const browser = new Browser()
    await browser.signIn()
    const duplicate = await browser.post('/operators/tenants/acme/roles', {
      _action: 'save',
      key: 'editor',
      permissions: 'content.admin',
    })
    expect(duplicate.headers.get('location')).toBe('/operators/tenants/acme/roles')
    expect(policy.writes).toEqual([])
    const page = await (await browser.request('/operators/tenants/acme/roles')).text()
    expect(page).toContain('exists already')

    const created = await browser.post('/operators/tenants/acme/roles', {
      _action: 'save',
      key: 'auditor',
      description: 'Reads the audit',
      permissions: 'audit.read',
    })
    expect(created.headers.get('location')).toBe('/operators/tenants/acme/roles/auditor')
    expect(policy.writes[0]?.body).toMatchObject({
      key: 'auditor',
      description: 'Reads the audit',
      permissions: ['audit.read'],
    })
    const detail = await (await browser.request('/operators/tenants/acme/roles/editor')).text()
    expect(detail).toContain('Holds in effect')
    expect(detail).toContain('included reader')
  })

  test('a part of a workspace the caller holds no key of is drawn closed, with its reason', async () => {
    const browser = new Browser()
    await browser.signIn()
    const html = await (await browser.request(`/workspaces/${WORKSPACE}`)).text()
    const from = html.indexOf('<nav class="tabs"')
    const tabs = html.slice(from, html.indexOf('</nav>', from))
    // Access gives content.read and content.write on the workspace. The
    // model and the audit have keys of their own, and the caller holds
    // neither: the two tabs say so before the caller follows them.
    expect(tabs).toContain(`href="/workspaces/${WORKSPACE}/model" class="locked"`)
    expect(tabs).toContain('Reading the data model needs the permission data.model.read')
    expect(tabs).toContain(`href="/workspaces/${WORKSPACE}/audit" class="locked"`)
    expect(tabs).toContain('Reading the audit needs the permission data.audit.read')
    expect(tabs).toContain(`<a href="/workspaces/${WORKSPACE}/access">Your access</a>`)
    // What the policies of Data refuse on a collection is named, and not left out.
    expect(html).toContain('<li class="can-mark can">')
    expect(html).toContain('<li class="can-mark cannot" title="')
    expect(html).toContain('do not let you delete records of Articles')
  })

  test('a right on the tenant itself names the tenant, and says what it opens there', async () => {
    resetPolicy()
    policy.roles.push({
      id: 'r-admin',
      tenant: 'acme',
      key: 'admin',
      displayName: 'Administrators',
      description: null,
      permissions: ['console.admin', 'console.status', 'data.model.read'],
      roles: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const browser = new Browser()
    await browser.signIn()
    // Alice holds nothing that opens the administration: her page offers it in one step.
    const before = await (
      await browser.request(`/operators/tenants/acme/users/${PRINCIPAL}`)
    ).text()
    expect(before).toContain('Make Alice an administrator')
    expect(before).toContain('<input type="hidden" name="workspace" value="tenant"/>')

    const granted = await browser.post('/operators/tenants/acme/rights', {
      _action: 'grant',
      _form: 'grant',
      back: `/operators/tenants/acme/users/${PRINCIPAL}`,
      holder: `user:${PRINCIPAL}`,
      kind: 'role',
      role: 'admin',
      workspace: 'tenant',
      expires: 'never',
    })
    expect(granted.headers.get('location')).toBe(`/operators/tenants/acme/users/${PRINCIPAL}`)
    // The tenant itself is the slug of the tenant, where Access holds a workspace.
    const body = policy.writes[0]?.body as Record<string, unknown>
    expect(body).toMatchObject({ userId: PRINCIPAL, role: 'admin', workspaceId: 'acme' })
    expect(body.routeId ?? null).toBeNull()

    const after = await (await browser.request(`/operators/tenants/acme/users/${PRINCIPAL}`)).text()
    expect(after).toContain('The role admin was granted.')
    // Access accepts a right that opens nothing where it holds: the page says it.
    expect(after).toContain(
      'data.model.read is read on a workspace: on the tenant itself it opens nothing.'
    )
    expect(after).toContain('The tenant itself')
    expect(after).toContain('opens the administration')
    expect(after).toContain('Alice administers acme through the role admin')
    expect(after).not.toContain('Make Alice an administrator')
  })

  test('a role that holds a capability of the platform is the platform’s to grant', async () => {
    resetPolicy()
    policy.roles.push({
      id: 'r-root',
      tenant: 'acme',
      key: 'root',
      displayName: 'Root',
      description: null,
      permissions: ['console.platform'],
      roles: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const fields = {
      _action: 'grant',
      _form: 'grant',
      back: '/operators/tenants/acme/rights',
      holder: `user:${PRINCIPAL}`,
      kind: 'role',
      role: 'root',
      workspace: 'tenant',
      expires: 'never',
    }
    consoleKeys = ['console.admin', 'console.status']
    const operator = new Browser()
    await operator.signIn()
    await operator.post('/operators/tenants/acme/rights', fields)
    // Access refuses the permission and not the role that holds it: the
    // console refuses both, before anything is written.
    expect(policy.writes).toEqual([])
    const refused = await (await operator.request('/operators/tenants/acme/rights')).text()
    expect(refused).toContain('console.platform is a capability of the platform')
    expect(refused).toContain('not yours to give')

    consoleKeys = ['console.platform', 'console.status']
    try {
      const platform = new Browser()
      await platform.signIn()
      seen.adminCalls.length = 0
      await platform.post('/operators/tenants/acme/rights', fields)
      expect(policy.writes.map((entry) => entry.body)).toEqual([
        expect.objectContaining({ role: 'root', workspaceId: 'acme' }),
      ])
      const write = seen.adminCalls.find((call) => call.startsWith('PUT /v1/admin/grants '))
      expect(write).toContain('Bearer the-platform-token-0001')
    } finally {
      consoleKeys = ['console.admin', 'console.status']
    }
  })

  test('a role does not come to include a capability of the platform by the hand of a tenant', async () => {
    resetPolicy()
    policy.roles.push({
      id: 'r-root',
      tenant: 'acme',
      key: 'root',
      displayName: 'Root',
      description: null,
      permissions: ['console.platform'],
      roles: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    consoleKeys = ['console.admin', 'console.status']
    const browser = new Browser()
    await browser.signIn()
    // The editors would hold the capability through the role: everybody
    // who holds the role would, without a grant.
    await browser.post('/operators/tenants/acme/roles/editor', [
      ['_action', 'save'],
      ['key', 'editor'],
      ['displayName', 'Editors'],
      ['permissions', 'content.write'],
      ['roles', 'reader'],
      ['roles', 'root'],
    ])
    expect(policy.writes).toEqual([])
    const page = await (await browser.request('/operators/tenants/acme/roles/editor')).text()
    expect(page).toContain('The role was not saved')
    expect(page).toContain('console.platform is a capability of the platform')
    // The grid draws the role that holds it as closed, cell by cell.
    const grid = await (await browser.request('/operators/tenants/acme/roles?view=matrix')).text()
    expect(grid).toContain('closed to you')
    expect(grid).not.toContain('name="perm:root"')
  })

  test('a role is not saved without the key of the administration before the operator says so', async () => {
    resetPolicy()
    policy.roles.push({
      id: 'r-admin',
      tenant: 'acme',
      key: 'admin',
      displayName: 'Administrators',
      description: null,
      permissions: ['console.admin', 'console.status'],
      roles: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    policy.grants.push({
      id: 'g-admin',
      tenant: 'acme',
      userId: PRINCIPAL,
      permission: null,
      role: 'admin',
      workspaceId: 'acme',
      routeId: null,
      expiresAt: null,
      revokedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const browser = new Browser()
    await browser.signIn()
    const path = '/operators/tenants/acme/roles/admin'
    const before = await (await browser.request(path)).text()
    expect(before).toContain('opens the administration of acme to the holders of 1 live right')
    expect(before).toContain('yours among them')

    // The role is sent without console.admin: everybody who holds it
    // would lose the administration, the operator who sends it too.
    const fields: [string, string][] = [
      ['_action', 'save'],
      ['key', 'admin'],
      ['displayName', 'Administrators'],
      ['permissions', 'console.status'],
    ]
    await browser.post(path, fields)
    expect(policy.writes).toEqual([])
    const asked = await (await browser.request(path)).text()
    expect(asked).toContain('The role was not saved: the form asks a question first.')
    expect(asked).toContain('yours among them: your next page would be a refusal')
    expect(asked).toContain('name="closesAdministration"')

    // The grid draws the cell closed, and refuses the same write.
    const grid = await (await browser.request('/operators/tenants/acme/roles?view=matrix')).text()
    expect(grid).not.toMatch(/name="perm:admin" value="console\.admin"/)
    expect(grid).toContain('This is how you administer acme yourself.')
    await browser.post('/operators/tenants/acme/roles?view=matrix', [
      ['_action', 'matrix'],
      ['role', 'admin'],
      ['shown:admin', 'console.admin\nconsole.status'],
      ['perm:admin', 'console.status'],
    ])
    expect(policy.writes).toEqual([])
    const refused = await (
      await browser.request('/operators/tenants/acme/roles?view=matrix')
    ).text()
    expect(refused).toContain('the change closes the administration of acme')

    // Once the operator said so, the role is written as it was sent.
    await browser.post(path, [...fields, ['closesAdministration', 'yes']])
    expect(policy.writes.map((entry) => entry.body)).toEqual([
      expect.objectContaining({ key: 'admin', permissions: ['console.status'] }),
    ])
  })

  test('the grid of the roles writes the roles whose cells changed, and no other', async () => {
    resetPolicy()
    const browser = new Browser()
    await browser.signIn()
    const grid = await (await browser.request('/operators/tenants/acme/roles?view=matrix')).text()
    expect(grid).toContain('<table class="matrix">')
    expect(grid).toMatch(/name="perm:editor" value="content\.write" checked=""/)
    // The editors read through the readers: the cell says where it comes from.
    expect(grid).toContain('via reader')
    // A capability of the platform is a row of closed cells for the operator of a tenant.
    expect(grid).toContain('<code>console.platform</code>')
    expect(grid).not.toContain('value="console.platform"')

    // The readers are given content.write, the editors a permission the
    // tenant does not name yet; nothing else is touched.
    const saved = await browser.post('/operators/tenants/acme/roles?view=matrix', [
      ['_action', 'matrix'],
      ['role', 'editor'],
      ['shown:editor', 'content.write'],
      ['role', 'reader'],
      ['shown:reader', 'content.read'],
      ['perm:editor', 'content.write'],
      ['perm:reader', 'content.read'],
      ['perm:reader', 'content.write'],
      ['new', 'content.archive'],
      ['new:editor', 'yes'],
    ])
    expect(saved.headers.get('location')).toBe('/operators/tenants/acme/roles?view=matrix')
    const written = Object.fromEntries(
      policy.writes.map((entry) => {
        const body = entry.body as { key: string; permissions: string[]; roles: string[] }
        return [body.key, body]
      })
    )
    expect(Object.keys(written).sort()).toEqual(['editor', 'reader'])
    expect(written.editor).toMatchObject({
      permissions: ['content.archive', 'content.write'],
      roles: ['reader'],
    })
    expect(written.reader).toMatchObject({ permissions: ['content.read', 'content.write'] })
    const after = await (await browser.request('/operators/tenants/acme/roles?view=matrix')).text()
    expect(after).toContain('Saved 2 roles')

    // A grid that comes back as it was drawn writes nothing.
    policy.writes.length = 0
    await browser.post('/operators/tenants/acme/roles?view=matrix', [
      ['_action', 'matrix'],
      ['role', 'reader'],
      ['shown:reader', 'content.read\ncontent.write'],
      ['perm:reader', 'content.read'],
      ['perm:reader', 'content.write'],
    ])
    expect(policy.writes).toEqual([])

    // A cell that was closed and comes back ticked is refused with the reason of the rule.
    await browser.post('/operators/tenants/acme/roles?view=matrix', [
      ['_action', 'matrix'],
      ['role', 'reader'],
      ['shown:reader', 'content.read\ncontent.write'],
      ['perm:reader', 'content.read'],
      ['perm:reader', 'content.write'],
      ['perm:reader', 'console.platform'],
    ])
    expect(policy.writes).toEqual([])
    const refused = await (
      await browser.request('/operators/tenants/acme/roles?view=matrix')
    ).text()
    expect(refused).toContain('No role was saved.')
    expect(refused).toContain('not yours to give')
  })

  test('the groups of a user are changed on the page of the user', async () => {
    resetPolicy()
    policy.groups.push({
      id: 'grp-2',
      tenant: 'acme',
      key: 'night',
      displayName: null,
      members: ['user-bob'],
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const browser = new Browser()
    await browser.signIn()
    const path = `/operators/tenants/acme/users/${PRINCIPAL}`
    // Alice stays in the team and joins the night shift: one group is
    // written, with the members it had and her.
    await browser.post(path, [
      ['_action', 'groups'],
      ['groups', 'team'],
      ['groups', 'night'],
    ])
    expect(policy.writes).toEqual([
      {
        method: 'POST',
        path: '/v1/admin/groups',
        body: expect.objectContaining({ key: 'night', members: ['user-bob', 'user-alice'] }),
      },
    ])
    expect(await (await browser.request(path)).text()).toContain('Alice joined night.')

    // A form that names no group takes her out of the one she is in.
    policy.writes.length = 0
    await browser.post(path, { _action: 'groups' })
    expect(policy.writes.map((entry) => entry.body)).toEqual([
      expect.objectContaining({ key: 'team', displayName: 'The team', members: [] }),
    ])
  })

  test('a user of another provider is written at its provider, and found in its groups', async () => {
    resetPolicy()
    const erin = {
      ...ALICE,
      id: '55555555-5555-4555-8555-555555555555',
      provider: 'contractors',
      externalSubject: 'user-erin',
      email: 'erin@acme.test',
      displayName: 'Erin',
    }
    policy.users.push(erin)
    // A group names a member of another provider with the provider.
    policy.groups.push({
      id: 'grp-2',
      tenant: 'acme',
      key: 'night',
      displayName: null,
      members: ['contractors/user-erin'],
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const browser = new Browser()
    await browser.signIn()
    const path = `/operators/tenants/acme/users/${erin.id}`
    const html = await (await browser.request(path)).text()
    expect(html).toContain('<input type="hidden" name="groups" value="night"/>')

    // Disabling her names her provider: the subject alone names a
    // principal of the default provider, and would disable nobody.
    await browser.post(path, { _action: 'status', status: 'disabled' })
    expect(policy.writes.map((entry) => entry.body)).toEqual([
      expect.objectContaining({
        provider: 'contractors',
        externalSubject: 'user-erin',
        status: 'disabled',
      }),
    ])

    // Leaving her group takes her name out of it, the provider with it.
    policy.writes.length = 0
    await browser.post(path, { _action: 'groups' })
    expect(policy.writes.map((entry) => entry.body)).toEqual([
      expect.objectContaining({ key: 'night', members: [] }),
    ])
  })

  test('a group that gives a capability of the platform is filled by the platform', async () => {
    resetPolicy()
    consoleKeys = ['console.admin', 'console.status']
    policy.users.push({
      ...ALICE,
      id: '66666666-6666-4666-8666-666666666666',
      externalSubject: 'user-bob',
      email: 'bob@acme.test',
      displayName: 'Bob',
    })
    // The team holds the role root, and the role holds the capability: a
    // member of the team administers every tenant.
    policy.roles.push({
      id: 'r-root',
      tenant: 'acme',
      key: 'root',
      displayName: null,
      description: null,
      permissions: ['console.platform'],
      roles: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    policy.grants.push({
      id: 'g-root',
      tenant: 'acme',
      group: 'team',
      permission: null,
      role: 'root',
      workspaceId: 'acme',
      routeId: 'console',
      expiresAt: null,
      revokedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const browser = new Browser()
    await browser.signIn()
    const path = '/operators/tenants/acme/groups/team'

    // The page says who fills the group, and the picker offers nobody new.
    const page = await (await browser.request(path)).text()
    expect(page).toContain('Members are added by an operator of the platform')
    expect(page).toContain('not yours to give')
    expect(page).toContain('alice@acme.test')
    expect(page).not.toContain('bob@acme.test')

    // The operator of a tenant adds nobody: nothing is written, and the
    // refusal names what the group gives.
    await browser.post(path, [
      ['_action', 'members'],
      ['members', 'user-alice'],
      ['members', 'user-bob'],
    ])
    expect(policy.writes).toEqual([])
    const refused = await (await browser.request(path)).text()
    expect(refused).toContain('The members were not saved')
    expect(refused).toContain('The group gives console.platform to every member.')

    // Taking a member away is the tenant's own write, with its credential.
    seen.adminCalls.length = 0
    await browser.post(path, { _action: 'members' })
    expect(policy.writes.map((entry) => entry.body)).toEqual([
      expect.objectContaining({ key: 'team', members: [] }),
    ])
    expect(seen.adminCalls.find((call) => call.startsWith('POST /v1/admin/groups '))).toContain(
      'Bearer the-acme-token-00001'
    )

    // An operator of the platform adds the member, and the write is
    // signed with the credential of the platform: Access refuses the
    // one of the tenant.
    policy.writes.length = 0
    consoleKeys = ['console.platform', 'console.status']
    const platform = new Browser()
    await platform.signIn()
    const open = await (await platform.request(path)).text()
    expect(open).toContain('A new member is given a capability of the platform')
    expect(open).toContain('bob@acme.test')
    seen.adminCalls.length = 0
    await platform.post(path, [
      ['_action', 'members'],
      ['members', 'user-alice'],
      ['members', 'user-bob'],
    ])
    expect(policy.writes.map((entry) => entry.body)).toEqual([
      expect.objectContaining({ key: 'team', members: ['user-alice', 'user-bob'] }),
    ])
    expect(seen.adminCalls.find((call) => call.startsWith('POST /v1/admin/groups '))).toContain(
      'Bearer the-platform-token-0001'
    )
    consoleKeys = ['console.admin', 'console.status']
  })

  test('a user joins a group that gives a capability of the platform by the hand of the platform', async () => {
    resetPolicy()
    consoleKeys = ['console.admin', 'console.status']
    policy.groups.push(
      {
        id: 'grp-2',
        tenant: 'acme',
        key: 'night',
        displayName: null,
        members: [],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'grp-3',
        tenant: 'acme',
        key: 'board',
        displayName: 'The board',
        members: ['user-bob'],
        createdAt: '2026-01-01T00:00:00.000Z',
      }
    )
    policy.grants.push({
      id: 'g-board',
      tenant: 'acme',
      group: 'board',
      permission: 'console.platform',
      workspaceId: 'acme',
      routeId: 'console',
      expiresAt: null,
      revokedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const browser = new Browser()
    await browser.signIn()
    const path = `/operators/tenants/acme/users/${PRINCIPAL}`

    // The picker of an operator of a tenant does not offer the board, and says so.
    const page = await (await browser.request(path)).text()
    expect(page).toContain('Not offered: The board.')

    // Alice joins the night shift and not the board: one group is
    // written, and the refusal of the other names what it gives.
    const wanted = [
      ['_action', 'groups'],
      ['groups', 'team'],
      ['groups', 'night'],
      ['groups', 'board'],
    ] as const
    await browser.post(path, wanted)
    expect(policy.writes.map((entry) => entry.body)).toEqual([
      expect.objectContaining({ key: 'night', members: ['user-alice'] }),
    ])
    const after = await (await browser.request(path)).text()
    expect(after).toContain('Alice joined night.')
    expect(after).toContain('board: The group gives console.platform to every member.')

    // An operator of the platform signs each write with the credential
    // it needs: the one of the tenant for the night shift, and the one
    // of the platform for the board.
    policy.writes.length = 0
    consoleKeys = ['console.platform', 'console.status']
    const platform = new Browser()
    await platform.signIn()
    expect(await (await platform.request(path)).text()).not.toContain('Not offered')
    seen.adminCalls.length = 0
    await platform.post(path, wanted)
    expect(policy.writes.map((entry) => entry.body)).toEqual([
      expect.objectContaining({ key: 'night', members: ['user-alice'] }),
      expect.objectContaining({ key: 'board', members: ['user-bob', 'user-alice'] }),
    ])
    expect(seen.adminCalls.filter((call) => call.startsWith('POST /v1/admin/groups '))).toEqual([
      'POST /v1/admin/groups Bearer the-acme-token-00001',
      'POST /v1/admin/groups Bearer the-platform-token-0001',
    ])
    consoleKeys = ['console.admin', 'console.status']
  })

  test('a tenant the console cannot read whole is not taken for one whose groups give nothing', async () => {
    resetPolicy()
    policy.users.push({
      ...ALICE,
      id: '66666666-6666-4666-8666-666666666666',
      externalSubject: 'user-bob',
      email: 'bob@acme.test',
      displayName: 'Bob',
    })
    // More live rights than the console reads of a tenant, and the one
    // that gives the capability to the team is the last of them.
    for (let index = 0; index < 1000; index += 1) {
      policy.grants.push({
        id: `g-many-${index}`,
        tenant: 'acme',
        userId: '99999999-9999-4999-8999-999999999999',
        permission: 'content.reader',
        workspaceId: WORKSPACE,
        routeId: 'data-api',
        expiresAt: null,
        revokedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    }
    policy.grants.push({
      id: 'g-last',
      tenant: 'acme',
      group: 'team',
      permission: 'console.platform',
      workspaceId: 'acme',
      routeId: 'console',
      expiresAt: null,
      revokedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const path = '/operators/tenants/acme/groups/team'
    const members = [
      ['_action', 'members'],
      ['members', 'user-alice'],
      ['members', 'user-bob'],
    ] as const
    const signerOf = () => seen.adminCalls.find((call) => call.startsWith('POST /v1/admin/groups '))

    // The operator of a tenant signs with the credential of its tenant:
    // Access reads every right of the group, and it answers.
    consoleKeys = ['console.admin', 'console.status']
    const browser = new Browser()
    await browser.signIn()
    seen.adminCalls.length = 0
    await browser.post(path, members)
    expect(signerOf()).toContain('Bearer the-acme-token-00001')

    // The operator of the platform signs with the credential of the
    // platform, which may always add a member.
    consoleKeys = ['console.platform', 'console.status']
    const platform = new Browser()
    await platform.signIn()
    seen.adminCalls.length = 0
    await platform.post(path, members)
    expect(signerOf()).toContain('Bearer the-platform-token-0001')
    consoleKeys = ['console.admin', 'console.status']
  })

  test('the creator of a workspace is given the role of the administration, by who may give it', async () => {
    const admin = {
      id: 'r-admin',
      tenant: 'acme',
      key: 'admin',
      displayName: 'Administrators',
      description: null,
      permissions: ['console.admin', 'data.model.write'],
      roles: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const create = async (browser: Browser) => {
      policy.writes.length = 0
      seen.adminCalls.length = 0
      const answer = await browser.post('/workspaces/new', { slug: 'press', displayName: 'Press' })
      expect(answer.headers.get('location')).toBe(`/workspaces/${CREATED_WORKSPACE}`)
      return seen.adminCalls.find((call) => call.startsWith('PUT /v1/admin/grants '))
    }
    const granted = [expect.objectContaining({ role: 'admin', workspaceId: CREATED_WORKSPACE })]

    // The role of a tenant: the grant is the tenant's own write.
    resetPolicy()
    policy.roles.push(admin)
    consoleKeys = ['console.admin', 'console.status', 'data.workspace.create']
    const browser = new Browser()
    await browser.signIn()
    expect(await create(browser)).toContain('Bearer the-acme-token-00001')
    expect(policy.writes.map((entry) => entry.body)).toEqual(granted)

    // The platform wrote its capability in the role: the grant of the
    // role is the platform's, and the creator of a workspace who is not
    // its operator is told that the workspace has no rights yet.
    policy.roles = [
      ...policy.roles.filter((role) => role.key !== 'admin'),
      { ...admin, permissions: [...admin.permissions, 'console.platform'] },
    ]
    expect(await create(browser)).toBeUndefined()
    expect(policy.writes).toEqual([])
    expect(await (await browser.request('/workspaces/new')).text()).toContain(
      'only an operator of the platform grants it'
    )

    // An operator of the platform is given it, with the credential of
    // the platform: Access refuses the one of the tenant.
    consoleKeys = ['console.platform', 'console.status', 'data.workspace.create']
    const platform = new Browser()
    await platform.signIn()
    expect(await create(platform)).toContain('Bearer the-platform-token-0001')
    expect(policy.writes.map((entry) => entry.body)).toEqual(granted)
    consoleKeys = ['console.admin', 'console.status']
  })

  test('a page of the administration does not wait for Data to name a workspace', async () => {
    const grantOn = (id: string, workspaceId: string) => ({
      id,
      tenant: 'acme',
      userId: PRINCIPAL,
      permission: 'content.read',
      workspaceId,
      routeId: 'data-api',
      expiresAt: null,
      revokedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    try {
      // The name of a workspace is a courtesy: the page that asked for
      // one that does not come shows the identifier, and answers.
      resetPolicy()
      policy.grants.push(grantOn('g-slow', SLOW_WORKSPACE))
      const waiting = new Browser()
      await waiting.signIn()
      const started = Date.now()
      const slow = await (await waiting.request('/operators/tenants/acme/rights')).text()
      expect(Date.now() - started).toBeLessThan(3500)
      expect(slow).toContain('The Acme workspace')
      expect(slow).toContain(`<code title="${SLOW_WORKSPACE}">77777777…</code>`)

      // A Data that does not answer is not asked again by the next page.
      resetPolicy()
      policy.grants.push(grantOn('g-down', DOWN_WORKSPACE))
      const browser = new Browser()
      await browser.signIn()
      await browser.request('/operators/tenants/acme/rights')
      seen.bearers.length = 0
      const again = await (await browser.request('/operators/tenants/acme/rights')).text()
      expect(seen.bearers).toEqual([])
      expect(again).toContain(`<code title="${DOWN_WORKSPACE}">88888888…</code>`)
    } finally {
      resetPolicy()
    }
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

  test('a reader chooses a role, and the documentation follows it until they change it', async () => {
    const browser = new Browser()
    const choose = await browser.request('/docs?role=sysops&to=gateway%2Foperations')
    expect(choose.status).toBe(303)
    expect(choose.headers.get('location')).toBe('/docs/gateway/operations')
    const cookie = choose.headers
      .getSetCookie()
      .find((line) => line.startsWith('console_docs_role='))
    expect(cookie).toContain('console_docs_role=sysops')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Path=/docs')

    const home = await (await browser.request('/docs')).text()
    expect(home).toContain('Reading as')
    expect(home).toContain('<h1>Platform operator</h1>')

    const page = await (await browser.request('/docs/gateway/operations')).text()
    expect(page).toContain('<a href="/docs/roles/sysops">Platform operator</a>')
    expect(page).toContain('Platform operator · ')

    const forget = await browser.request('/docs?role=all')
    expect(forget.headers.get('location')).toBe('/docs')
    const after = await (await browser.request('/docs')).text()
    expect(after).toContain('Choose your role')
  })

  test('the choice of a role follows only a page of the documentation, and an unknown role is ignored', async () => {
    const browser = new Browser()
    const away = await browser.request('/docs?role=sysops&to=https%3A%2F%2Fexample.com')
    expect(away.headers.get('location')).toBe('/docs')
    const unknown = await new Browser().request('/docs?role=nobody')
    expect(unknown.status).toBe(303)
    expect(
      unknown.headers.getSetCookie().some((line) => line.startsWith('console_docs_role='))
    ).toBe(false)
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
