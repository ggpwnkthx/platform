/**
 * The identity of the caller.
 *
 * The CLI signs in the way a program signs in: it opens the login of
 * the provider, the provider sends the caller back with a code, and the
 * code is exchanged for a token. The token is stored in the file of the
 * credentials of the machine, and it is never printed.
 *
 * The loopback address of the callback has to be one the tenant allows:
 * a provider that sends the caller to an address it does not know
 * refuses the login, and the CLI says so instead of failing in silence.
 */

import type {
  BrowserPort,
  CallbackPort,
  Credential,
  CredentialStorePort,
  CryptoPort,
  HttpPort,
} from './contracts'
import { CliFailure } from './failure'
import { expectSuccess } from './answer'

/** The parameters of a sign in. */
export interface SignIn {
  /** The transport of the call. */
  readonly http: HttpPort
  /** The browser of the machine. */
  readonly browser: BrowserPort
  /** The server of the callback. */
  readonly callback: CallbackPort
  /** The randomness of the login. */
  readonly crypto: CryptoPort
  /** The store of the credential. */
  readonly credentials: CredentialStorePort
  /** The address of Access. */
  readonly accessUrl: string
  /** The client the CLI signs in with. */
  readonly clientId: string
  /** The secret of the client. */
  readonly clientSecret: string
  /** The address the provider sends the caller back to. */
  readonly redirectUri: string
  /** The tenant of a shared client. */
  readonly tenant?: string
  /** The scopes the CLI asks for. */
  readonly scope?: string
}

/**
 * The text of an address in base64url, without the padding.
 *
 * @param bytes the bytes to write.
 */
function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/**
 * The address of the callback, and the parts of it.
 *
 * The callback of a CLI runs on the loopback address of the machine: a
 * provider that sends the caller to a name that resolves nowhere is a
 * login that never ends.
 *
 * @param redirectUri the address of the callback.
 */
function callbackOf(redirectUri: string): { host: string; port: number; path: string } {
  let url: URL
  try {
    url = new URL(redirectUri)
  } catch {
    throw new CliFailure(
      `the address of the callback is not an address: ${redirectUri}`,
      2,
      'invalid'
    )
  }
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '::1') {
    throw new CliFailure(
      `the address of the callback has to be on the machine of the caller: ${redirectUri}`,
      2,
      'invalid'
    )
  }
  const port = url.port === '' ? 80 : Number(url.port)
  return { host: url.hostname, port, path: url.pathname === '' ? '/' : url.pathname }
}

/**
 * The address of the login.
 *
 * @param signIn the parameters of the sign in.
 * @param state the state of the login.
 * @param challenge the challenge of the proof of the caller.
 */
function authorizeUrl(signIn: SignIn, state: string, challenge: string): string {
  const url = new URL(`${signIn.accessUrl}/oauth/authorize`)
  url.searchParams.set('client_id', signIn.clientId)
  url.searchParams.set('redirect_uri', signIn.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', signIn.scope ?? 'openid profile email groups')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (signIn.tenant) url.searchParams.set('tenant', signIn.tenant)
  return url.toString()
}

/**
 * Signs the caller in and stores its credential.
 *
 * @param signIn the parameters of the sign in.
 */
export async function signIn(signIn: SignIn): Promise<Credential> {
  const verifier = base64url(signIn.crypto.randomBytes(32))
  const challenge = base64url(signIn.crypto.sha256(Buffer.from(verifier)))
  const state = base64url(signIn.crypto.randomBytes(16))
  const server = await signIn.callback.start(callbackOf(signIn.redirectUri))
  const url = authorizeUrl(signIn, state, challenge)
  await signIn.browser.open(url)
  const answered = await server.wait()
  if (answered.state !== state) {
    throw new CliFailure(
      'the provider answered with another state than the one of the login',
      8,
      'state_mismatch'
    )
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: answered.code,
    redirect_uri: signIn.redirectUri,
    code_verifier: verifier,
  })
  const answer = await signIn.http.send({
    method: 'POST',
    url: `${signIn.accessUrl}/oauth/token`,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${signIn.clientId}:${signIn.clientSecret}`).toString('base64')}`,
    },
    body: body.toString(),
  })
  const token = expectSuccess(answer, 'the exchange of the code') as {
    access_token?: string
    expires_in?: number
    sub?: string
  }
  if (!token.access_token) {
    throw new CliFailure('the provider answered without a token', 8, 'no_token')
  }
  const credential: Credential = {
    accessToken: token.access_token,
    expiresAt:
      typeof token.expires_in === 'number' ? Date.now() + token.expires_in * 1000 : undefined,
  }
  await signIn.credentials.write(credential)
  return credential
}

/**
 * The claims of the caller.
 *
 * @param http the transport of the call.
 * @param accessUrl the address of Access.
 * @param credential the credential of the caller.
 */
export async function claimsOf(
  http: HttpPort,
  accessUrl: string,
  credential: Credential
): Promise<unknown> {
  const answer = await http.send({
    method: 'GET',
    url: `${accessUrl}/oauth/userinfo`,
    token: credential.accessToken,
  })
  return expectSuccess(answer, 'the claims of the caller')
}
