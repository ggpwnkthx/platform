/**
 * The published interface's own path, in a real browser: sign in through an issuer, then
 * PostgreSQL's protocol over a WebSocket through the relay. Run by `bun run test:e2e`.
 *
 * The issuer here is a stand-in that vouches for one address, and the PostgreSQL behind the
 * relay (PGlite, over a socket) signs nobody in, so this proves the transport and the sign-in
 * round trip — not PostgreSQL 18's check of the token, which needs the real server.
 */
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { pgliteParsers } from '@platform/core/pglite'
import { startRelay } from '@platform/relay'

const text = (path: string) => Bun.file(new URL(`../../../${path}`, import.meta.url)).text()
const site = `http://localhost:${process.env.PLATFORM_SITE_PORT ?? 5180}`
const issuer = 'http://localhost:5560'

const pg = await PGlite.create({ parsers: pgliteParsers })
for (const file of [
  'migrations/0001_platform.sql',
  'examples/newsroom/apply/schema.sql',
  'examples/newsroom/apply/demo.sql',
])
  await pg.exec(await text(file))
await new PGLiteSocketServer({ db: pg, port: 54420, host: '127.0.0.1', maxConnections: 10 }).start()
const relay = startRelay({
  upstream: { host: '127.0.0.1', port: 54420 },
  port: 5181,
  allowedOrigins: [site],
})

// The token is signed as an issuer signs one, with a key made for the occasion.
const key = await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  false,
  ['sign', 'verify']
)
const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = async (claims: object) => {
  const signed = `${part({ alg: 'RS256', typ: 'JWT' })}.${part(claims)}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key.privateKey,
    Buffer.from(signed)
  )
  return `${signed}.${Buffer.from(signature).toString('base64url')}`
}
const cors = { 'access-control-allow-origin': site }
Bun.serve({
  port: 5560,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/.well-known/openid-configuration')
      return Response.json(
        { issuer, authorization_endpoint: `${issuer}/auth`, token_endpoint: `${issuer}/token` },
        { headers: cors }
      )
    if (url.pathname === '/auth')
      return Response.redirect(
        `${url.searchParams.get('redirect_uri')}?code=one&state=${url.searchParams.get('state')}`
      )
    const claims = { iss: issuer, sub: '1', aud: 'platform-console', email: 'admin@example.com' }
    const now = Math.floor(Date.now() / 1000)
    return Response.json(
      {
        token_type: 'Bearer',
        expires_in: 3600,
        access_token: 'opaque',
        id_token: await jwt({ ...claims, iat: now, exp: now + 3600 }),
      },
      { headers: cors }
    )
  },
})
console.log(`ready: the relay on ${relay.port}, the issuer on 5560`)
