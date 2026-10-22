/**
 * The authentication of a call of the administration (spec §10.1).
 *
 * The token is compared in constant time, a failure is counted, and the
 * call answers the scope of the credential it presented.
 */

import { sameSecret } from '../../observability'
import type { AdminScope } from './credentials'
import { AdministrationError } from './errors'
import type { AdministrationOptions } from './options'

/**
 * Authenticates a call of the administration.
 *
 * The token is compared in constant time. A failure is counted: a burst
 * of them is refused with `429`, so the token cannot be guessed by
 * hammering the endpoint.
 *
 * The budget of an address is spent by the calls that **fail**. A call
 * that authenticates itself is answered, whatever the address presented
 * before: an address that used up its budget cannot lock out the
 * operator that holds the token.
 *
 * Two tokens are accepted during a rotation: the one of the deployment
 * and the one it replaced.
 *
 * The call answers the **scope** of the credential it presented: the
 * tenant it may act for and the operator it is. The token of the
 * platform is the scope of the platform (spec §10.1).
 */
export async function authenticate(
  options: AdministrationOptions,
  header: string | undefined,
  address: string
): Promise<AdminScope> {
  const expected = options.token
  const previous = options.previousToken
  const credentials = options.credentials ?? []
  const match = /^Bearer\s+(.+)$/i.exec((header ?? '').trim())
  const presented = match?.[1]?.trim() ?? ''

  // Every candidate is compared, and the comparison does not stop at
  // the first one: the time of the answer may not tell which of the
  // credentials was presented.
  const comparisons: boolean[] = []
  if (expected !== undefined) comparisons.push(sameSecret(presented, expected))
  if (previous !== undefined) comparisons.push(sameSecret(presented, previous))
  for (const credential of credentials) {
    comparisons.push(sameSecret(presented, credential.token))
  }
  const accepted = presented !== '' && comparisons.some(Boolean)

  if (!accepted) {
    // The address that used up its budget is refused, and it is refused
    // here: the budget is the one of the calls that fail.
    const blocked = await options.limiter.blocked(address)
    if (blocked.blocked) {
      throw new AdministrationError(
        'too_many_requests',
        'too many failed authentications from this address',
        blocked.retryAfterMs
      )
    }
    const failure = await options.limiter.fail(address)
    if (!failure.allowed) {
      throw new AdministrationError(
        'too_many_requests',
        'too many failed authentications from this address',
        failure.retryAfterMs
      )
    }
    throw new AdministrationError('unauthorized', 'a valid administration token is required')
  }
  await options.limiter.succeed(address)

  // The scope of the call: the credential of a tenant is scoped to it,
  // and the token of the platform is the scope of the platform.
  const credential = credentials.find((candidate) => sameSecret(presented, candidate.token))
  if (credential) {
    return { tenant: credential.tenant, operator: credential.operator }
  }
  return { tenant: null, operator: null }
}
