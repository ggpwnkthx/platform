import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto'

/**
 * A stand-in for Dex: an OpenID Connect issuer in this process. The test PostgreSQL server is
 * started trusting its URL, fetches its keys and verifies each token for real.
 */
export function startIssuer(url: string) {
  const key = () => generateKeyPairSync('rsa', { modulusLength: 2048 })
  const { publicKey, privateKey } = key()
  const kid = 'test-key'
  const base = new URL(url)
  const server = Bun.serve({
    hostname: base.hostname,
    port: Number(base.port),
    fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname === `${base.pathname.replace(/\/$/, '')}/.well-known/openid-configuration`)
        return Response.json({ issuer: url, jwks_uri: `${url}/keys` })
      if (pathname === `${base.pathname.replace(/\/$/, '')}/keys`)
        return Response.json({
          keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }],
        })
      return new Response('Not found', { status: 404 })
    },
  })
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return {
    /** A token as Dex would issue it for this person, unless a claim or the key says otherwise. */
    mint(email: string, claims: Record<string, unknown> = {}, signer: KeyObject = privateKey) {
      const now = Math.floor(Date.now() / 1000)
      const body = `${part({ alg: 'RS256', typ: 'JWT', kid })}.${part({
        iss: url,
        sub: `sub-${email}`,
        aud: 'platform-console',
        iat: now,
        exp: now + 300,
        email,
        email_verified: true,
        ...claims,
      })}`
      return `${body}.${createSign('RSA-SHA256').update(body).sign(signer).toString('base64url')}`
    },
    /** A key the issuer never published. */
    strangerKey: () => key().privateKey,
    stop: () => server.stop(true),
  }
}
