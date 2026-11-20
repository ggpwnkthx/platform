import type { RuntimeConfig } from '../config.ts'
import { claims, discoverIssuer, expiresAt, roleOf } from '@platform/vocabulary'

/**
 * Sign-in: authorization code with PKCE against the one issuer the database trusts. The page
 * exchanges the code itself, so there is no server of ours in the flow. The verifier outlives
 * the redirect in sessionStorage and is removed as soon as it is read; the token is never
 * stored anywhere but this page's memory.
 *
 * The token itself is read the same way the operator's tools read it: the claims are read,
 * never verified — the database verifies the signature, the issuer and the expiry at every
 * login.
 */

export { claims, expiresAt, roleOf }

interface Discovery {
  authorization_endpoint: string
  token_endpoint: string
  end_session_endpoint?: string
}
const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')

const random = (length: number) => base64url(crypto.getRandomValues(new Uint8Array(length)))

async function discover(config: RuntimeConfig): Promise<Discovery> {
  try {
    return (await discoverIssuer(config.issuer)) as Discovery
  } catch {
    throw new Error(`The sign-in service at ${config.issuer} did not answer.`)
  }
}

const pendingKey = 'platform.signin'
const returnKey = 'platform.return'

/** Where the issuer sends the reader back: the site's root, which every page can hand on from. */
const redirectUri = () => `${location.origin}/`

export async function beginSignIn(config: RuntimeConfig, returnTo: string): Promise<void> {
  const endpoints = await discover(config)
  const pending = { state: random(16), verifier: random(32) }
  sessionStorage.setItem(pendingKey, JSON.stringify(pending))
  sessionStorage.setItem(returnKey, returnTo)
  const challenge = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(pending.verifier)
  )
  location.assign(
    `${endpoints.authorization_endpoint}?${new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: 'openid email',
      state: pending.state,
      code_challenge: base64url(new Uint8Array(challenge)),
      code_challenge_method: 'S256',
    })}`
  )
}

export interface SignedIn {
  token: string
  /** Where the reader was when they chose to sign in. */
  returnTo: string
}

/** Completes the redirect when the issuer sent a code back; null when this load was not one. */
export async function completeSignIn(config: RuntimeConfig): Promise<SignedIn | null> {
  const answer = new URLSearchParams(location.search)
  if (!answer.has('code') && !answer.has('error')) return null
  const stored = sessionStorage.getItem(pendingKey)
  const returnTo = sessionStorage.getItem(returnKey) ?? '/'
  sessionStorage.removeItem(pendingKey)
  sessionStorage.removeItem(returnKey)
  history.replaceState(null, '', redirectUri())
  if (answer.has('error'))
    throw new Error(answer.get('error_description') ?? `Sign-in failed: ${answer.get('error')}`)
  let pending: { state: string; verifier: string } | null = null
  try {
    pending = stored ? JSON.parse(stored) : null
  } catch {
    pending = null
  }
  if (!pending || pending.state !== answer.get('state'))
    throw new Error('That sign-in did not start on this page. Sign in again.')
  const endpoints = await discover(config)
  const response = await fetch(endpoints.token_endpoint, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: answer.get('code') ?? '',
      redirect_uri: redirectUri(),
      client_id: config.clientId,
      code_verifier: pending.verifier,
    }),
  })
  const tokens = (await response.json().catch(() => ({}))) as {
    id_token?: string
    access_token?: string
    error_description?: string
  }
  if (!response.ok) throw new Error(tokens.error_description ?? 'The issuer refused the sign-in.')
  // The database validates the token the issuer signs for this client. Dex's access token is that
  // same signed JWT; the ID token is used when an issuer returns an opaque access token.
  const token = [tokens.access_token, tokens.id_token].find((t) => t && t.split('.').length === 3)
  if (!token) throw new Error('The issuer returned no signed token.')
  return { token, returnTo }
}
