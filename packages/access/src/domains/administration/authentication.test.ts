import { describe, expect, test } from 'bun:test'
import { sameSecret } from '../../observability'
import { createFakes, serviceOf } from './fakes'
import {
  AdministrationError,
  AdministrationService,
  FailedAuthenticationLimiter,
  PLATFORM_SCOPE,
} from './index'

/**
 * The authentication of the administration (spec §10.1).
 *
 * The token is compared in constant time, a failure is counted, and the
 * answer of a call is the scope of the credential it presented.
 */

const fakes = createFakes()

describe('the authentication of the administration', () => {
  test('the token is compared in constant time', () => {
    expect(sameSecret('the-token', 'the-token')).toBe(true)
    expect(sameSecret('the-token', 'another-token')).toBe(false)
    expect(sameSecret('the-token', 'the-toke')).toBe(false)
  })

  test('a missing token is refused', async () => {
    await expect(serviceOf(fakes).authenticate(undefined, '10.0.0.1')).rejects.toThrow(
      AdministrationError
    )
    await expect(serviceOf(fakes).authenticate('Bearer wrong', '10.0.0.1')).rejects.toThrow(
      /a valid administration token/
    )
  })

  test('the right token is accepted', async () => {
    await expect(
      serviceOf(fakes).authenticate('Bearer the-admin-token', '10.0.0.1')
    ).resolves.toEqual(PLATFORM_SCOPE)
  })

  test('a deployment without a token has no administrative surface', async () => {
    const administration = new AdministrationService({
      tenants: fakes.tenants,
      principals: fakes.principals,
      permissions: fakes.permissions,
      grants: fakes.grants,
      publicUrl: 'https://access.example.com',
      limiter: new FailedAuthenticationLimiter(fakes.failures),
    })
    await expect(administration.authenticate('Bearer the-admin-token', '10.0.0.1')).rejects.toThrow(
      /a valid administration token/
    )
  })

  test('a burst of failed authentications is refused', async () => {
    const administration = serviceOf(fakes, {
      limiter: new FailedAuthenticationLimiter(fakes.failures, { max: 3 }),
    })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(administration.authenticate('Bearer wrong', '10.0.0.2')).rejects.toThrow(
        AdministrationError
      )
    }
    let refused = false
    try {
      await administration.authenticate('Bearer wrong', '10.0.0.2')
    } catch (error) {
      refused = error instanceof AdministrationError && error.code === 'too_many_requests'
    }
    expect(refused).toBe(true)
    // The budget of an address is spent by the calls that fail: the right
    // token is answered, whatever the address presented before.
    await expect(
      administration.authenticate('Bearer the-admin-token', '10.0.0.2')
    ).resolves.toEqual(PLATFORM_SCOPE)
    // Another address is not affected.
    await expect(
      administration.authenticate('Bearer the-admin-token', '10.0.0.3')
    ).resolves.toEqual(PLATFORM_SCOPE)
  })

  test('a success clears the failures of the address', async () => {
    const limiter = new FailedAuthenticationLimiter(fakes.failures, { max: 2 })
    const administration = serviceOf(fakes, { limiter })
    await expect(administration.authenticate('Bearer wrong', '10.0.0.4')).rejects.toThrow()
    await expect(
      administration.authenticate('Bearer the-admin-token', '10.0.0.4')
    ).resolves.toEqual(PLATFORM_SCOPE)
    expect(await limiter.count('10.0.0.4')).toBe(0)
  })
})
