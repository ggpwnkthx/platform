import { roleOf } from '@platform/core'
import * as oidc from 'openid-client'
import type { RuntimeConfig } from '../config.ts'

/**
 * The sign-in: authorization code with PKCE against the one configured issuer, as a public
 * client. The token is handed back to the caller and kept nowhere; sessionStorage holds the
 * PKCE verifier across the redirect and is cleared when the page returns.
 */
const held = 'platform.signin'
const issuer = (config: RuntimeConfig) =>
  oidc.discovery(new URL(config.issuer), config.clientId, undefined, oidc.None(), {
    // A local issuer is plain HTTP; a deployment's is not.
    execute: config.issuer.startsWith('http://') ? [oidc.allowInsecureRequests] : [],
  })
const redirectUri = () => `${location.origin}/`

/** Leaves for the issuer. The page comes back with its answer in the address. */
export async function signIn(config: RuntimeConfig, returnTo: string): Promise<never> {
  const verifier = oidc.randomPKCECodeVerifier()
  const state = oidc.randomState()
  sessionStorage.setItem(held, JSON.stringify({ verifier, state, returnTo }))
  const address = oidc.buildAuthorizationUrl(await issuer(config), {
    redirect_uri: redirectUri(),
    scope: 'openid email',
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
  })
  location.assign(address.href)
  return new Promise<never>(() => undefined)
}

/** The issuer's answer, when the address carries one: the token, its role, and where to go back to. */
export async function signedIn(config: RuntimeConfig) {
  const answer = new URLSearchParams(location.search)
  if (!answer.has('state') || !(answer.has('code') || answer.has('error'))) return null
  const { verifier, state, returnTo } = JSON.parse(sessionStorage.getItem(held) ?? '{}')
  sessionStorage.removeItem(held)
  const here = new URL(location.href)
  // The address no longer carries the issuer's answer, and the page asked for is back in it.
  history.replaceState(null, '', `${location.pathname}#${returnTo ?? '/'}`)
  const tokens = await oidc.authorizationCodeGrant(await issuer(config), here, {
    pkceCodeVerifier: verifier,
    expectedState: state,
  })
  // PostgreSQL's validator reads a signed token: whichever of the two is one.
  const token = [tokens.access_token, tokens.id_token].find((t) => t?.split('.').length === 3)
  if (!token) throw new Error('The issuer returned no signed token.')
  const role = roleOf(token, config.claim)
  if (!role) throw new Error(`The token names no database role in its ${config.claim} claim.`)
  return { token, role }
}
