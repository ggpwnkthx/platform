/**
 * The tokens the platform trusts, read the same way on both sides of the wire.
 *
 * A token is a JWT: three parts, the middle one the claims, base64url written. The
 * operator's tools read a token to learn which role to ask PostgreSQL for; the interface
 * reads one to learn the same. Neither verifies it — PostgreSQL verifies the signature,
 * the issuer and the expiry at every login — so what is read here is a name, not a proof.
 */
import { jwtDecode } from 'jwt-decode'

/** The claims of a token, read without verifying it. */
export function claims(token: string): Record<string, unknown> {
  try {
    const parsed: unknown = jwtDecode(token)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * The role a token names, by the claim PostgreSQL matches against the role name. A name
 * PostgreSQL would refuse is no name at all: too long, or carrying a NUL.
 */
export function roleOf(token: string, claim: string): string | null {
  const value = claims(token)[claim]
  if (typeof value !== 'string' || !value) return null
  if (value.includes('\0')) return null
  if (new TextEncoder().encode(value).length > 63) return null
  return value
}

/** When the token stops being a login, in milliseconds since the epoch. */
export function expiresAt(token: string): number | null {
  const exp = claims(token).exp
  return typeof exp === 'number' ? exp * 1000 : null
}

/** What an OpenID Connect issuer offers. */
export interface Issuer {
  authorization_endpoint?: string
  token_endpoint?: string
  device_authorization_endpoint?: string
  end_session_endpoint?: string
}

/** The issuer's own account of itself, read from its discovery document. */
export async function discoverIssuer(issuer: string): Promise<Issuer> {
  // fallow-ignore-next-line security-sink -- the issuer is the one the deployment names; the path is the issuer's own
  const response = await fetch(`${issuer}/.well-known/openid-configuration`).catch(() => null)
  if (!response?.ok)
    throw new Error(
      `${issuer} is not an OpenID Connect issuer (${response?.status ?? 'no answer'})`
    )
  return (await response.json()) as Issuer
}
