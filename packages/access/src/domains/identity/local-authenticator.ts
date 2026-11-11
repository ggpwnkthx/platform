/**
 * The sign-in at a local provider (spec §5.4).
 *
 * The caller signs in with an address and a password. The service looks
 * the credential up, checks the password against its argon2id verifier,
 * and hands the callback a code that names the credential.
 *
 * **The answer of a failed sign-in says nothing about the accounts of the
 * tenant.** An address that names no account, a wrong password, a
 * disabled account and a locked account are the same refusal, and they
 * cost the same: the service verifies a password against nothing when
 * the address names no account, so that the time of the answer does not
 * tell the accounts of the tenant apart.
 *
 * **The guessing is expensive.** The failures of an address are counted
 * in the shared store of the deployment, and the failures of a credential
 * are counted in its row: a credential that fails too much is locked,
 * and the lock grows with the failures.
 */

import { providerStateOf } from './provider-state'
import {
  aLocalCode,
  hashOfLocalCode,
  LOCAL_CODE_TTL_SECONDS,
  type CredentialLookup,
  type LocalCodeStore,
  type PasswordHasher,
} from './local-provider'
import { LoginStateError, type LoginState, type StateCipher } from './state'

/** The failure of a sign-in at a local provider. */
export class LocalLoginError extends Error {
  constructor(
    /** The code of the failure. */
    readonly code:
      | 'invalid_request'
      | 'login_state_invalid'
      | 'identity_rejected'
      | 'too_many_requests',
    message: string
  ) {
    super(message)
    this.name = 'LocalLoginError'
  }
}

/**
 * The count of the failed sign-ins of an address.
 *
 * The count is held by the shared store of the deployment, so the window
 * of the limiter is the window of the deployment and not the window of a
 * replica. The storage of the count is a port of the identity domain:
 * the domain owns the rule, and the platform holds the count.
 */
interface AuthenticationFailures {
  /** Counts a failure of the address and answers the count of the window. */
  fail(address: string, windowMs: number): Promise<{ count: number; retryAfterMs: number }>
  /** The count of the failures of the address in the window. */
  count(address: string, windowMs: number): Promise<{ count: number; retryAfterMs: number }>
  /** Clears the count of the address: it signed in. */
  succeed(address: string): Promise<void>
}

/** The options of the sign-in at a local provider. */
export interface LocalAuthenticatorOptions {
  /** The storage of the credentials. */
  credentials: CredentialLookup
  /** The store of the local codes. */
  codes: LocalCodeStore
  /** The hasher of the passwords. */
  hasher: PasswordHasher
  /** The cipher of the state of a login. */
  state: StateCipher
  /** The secret of the deployment, for the binding of the state. */
  secret: string
  /**
   * The count of the failed sign-ins of an address.
   *
   * The count is held by the shared store of the deployment, so the
   * window of the limiter is the window of the deployment and not the
   * window of a replica.
   */
  failures?: AuthenticationFailures
  /** How many failures of an address are refused, in the window. */
  maxFailures?: number
  /** The window of the failures of an address, in milliseconds. */
  windowMs?: number
  /** The moment of the sign-in, in milliseconds. */
  now?: () => number
}

/** The form of the page of the password. */
export interface LocalForm {
  /** The slug of the tenant of the login. */
  tenant: string
  /** The slug of the provider of the login. */
  provider: string
  /**
   * The token of the form.
   *
   * It is the state of the provider: it is bound to the state of the
   * login and it cannot be forged, and the form that carries it is the
   * form of the login.
   */
  token: string
}

/** The outcome of a sign-in at a local provider. */
export interface LocalSignIn {
  /** The code the callback exchanges for the identity of the caller. */
  code: string
  /** The state of the provider, checked by the callback. */
  state: string
}

/** How many failures of an address are refused, in the window. */
const DEFAULT_MAX_FAILURES = 10

/** The window of the failures of an address, in milliseconds. */
const DEFAULT_WINDOW_MS = 60_000

/** The sign-in at a local provider. */
export class LocalAuthenticator {
  constructor(private readonly options: LocalAuthenticatorOptions) {}

  /** The moment of the sign-in. */
  private get now(): number {
    return (this.options.now ?? (() => Date.now()))()
  }

  /**
   * The form of the page of the password.
   *
   * The form is written for a login that is in flight: the cookie of the
   * state names the tenant, the provider and the nonce, and the token of
   * the form is the state of the provider.
   */
  form(cookie: string | undefined): LocalForm {
    const state = this.readState(cookie)
    return {
      tenant: state.tenant,
      provider: state.provider,
      token: providerStateOf(state, this.options.secret),
    }
  }

  /**
   * Signs a caller in.
   *
   * The code is the one the callback exchanges, and it names the
   * credential that signed in: the credential is the identity of the
   * caller, and the mapping of the identity is the work of the caller of
   * the domain (§6.2).
   *
   * @param options the address, the credentials and the token of the form.
   */
  async signIn(options: {
    cookie: string | undefined
    email: string
    password: string
    token: string
    address: string
  }): Promise<LocalSignIn> {
    const state = this.readState(options.cookie)

    // The token of the form is the state of the provider: a form that
    // carries another one is a form that was not written by the service.
    if (options.token !== providerStateOf(state, this.options.secret)) {
      throw new LocalLoginError('login_state_invalid', 'the form of the sign-in is not one of ours')
    }

    // The budget of the address is spent by the calls that **fail**: a
    // call that signs in is answered whatever the address presented
    // before, and it clears the count of the address.
    const failures = await this.options.failures?.count(
      options.address,
      this.options.windowMs ?? DEFAULT_WINDOW_MS
    )
    if (failures && failures.count >= (this.options.maxFailures ?? DEFAULT_MAX_FAILURES)) {
      throw new LocalLoginError(
        'too_many_requests',
        'too many failed sign-ins from this address: wait a minute and try again'
      )
    }

    const email = options.email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      // The shape of the address is a shape, not an account: the answer
      // is the answer of a failed sign-in.
      await this.options.hasher.verifyNothing(options.password)
      await this.fail(options.address)
      throw new LocalLoginError('identity_rejected', 'the address or the password is wrong')
    }

    const credential = await this.options.credentials.findByEmail(
      state.tenant,
      state.provider,
      email
    )

    if (!credential) {
      // The verification against nothing costs what a real one costs:
      // the answer of a sign-in says nothing about the accounts of the
      // tenant.
      await this.options.hasher.verifyNothing(options.password)
      await this.fail(options.address)
      throw new LocalLoginError('identity_rejected', 'the address or the password is wrong')
    }

    if (credential.status !== 'active') {
      await this.options.hasher.verify(credential.passwordHash, options.password)
      await this.fail(options.address)
      throw new LocalLoginError('identity_rejected', 'the address or the password is wrong')
    }

    if (credential.lockedUntil && credential.lockedUntil.getTime() > this.now) {
      // The account is locked: the answer is the answer of a failed
      // sign-in, and the reason is in the log of the service.
      await this.options.hasher.verify(credential.passwordHash, options.password)
      await this.fail(options.address)
      throw new LocalLoginError('identity_rejected', 'the address or the password is wrong')
    }

    const verified = await this.options.hasher.verify(credential.passwordHash, options.password)
    if (!verified) {
      await this.options.credentials.recordFailure(credential.id)
      await this.fail(options.address)
      throw new LocalLoginError('identity_rejected', 'the address or the password is wrong')
    }

    // The credential signed in: its failures are cleared, and so are the
    // failures of the address.
    await this.options.credentials.clearFailures(credential.id)
    await this.options.failures?.succeed(options.address)

    const code = aLocalCode()
    await this.options.codes.put(
      hashOfLocalCode(code),
      {
        credentialId: credential.id,
        tenant: state.tenant,
        provider: state.provider,
        nonce: state.nonce,
        email: credential.email,
      },
      LOCAL_CODE_TTL_SECONDS
    )
    return { code, state: providerStateOf(state, this.options.secret) }
  }

  /** Reads the state of the login, and refuses the one that is not readable. */
  private readState(cookie: string | undefined): LoginState {
    if (!cookie) {
      throw new LocalLoginError('login_state_invalid', 'the state of the login is missing')
    }
    try {
      return this.options.state.decrypt(cookie)
    } catch (error) {
      if (error instanceof LoginStateError) {
        throw new LocalLoginError('login_state_invalid', 'the state of the login is not readable')
      }
      throw error
    }
  }

  /** Counts a failure of the address. */
  private async fail(address: string): Promise<void> {
    await this.options.failures?.fail(address, this.options.windowMs ?? DEFAULT_WINDOW_MS)
  }
}
