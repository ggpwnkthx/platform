/**
 * The login of a caller (spec §5.4).
 *
 * The browser logs in at the provider of a tenant and comes back with a
 * principal. The service owns the two halves of the flow: it starts the
 * login and it finishes it.
 */

import { createHash, createHmac } from 'node:crypto'
import { ProviderError } from './provider-client'
import {
  mapIdentity,
  MappingError,
  type Mapping,
  type Principal,
  type PrincipalLookup,
} from './mapping'
import {
  aNonce,
  aVerifier,
  isAlive,
  LoginStateError,
  type LoginState,
  type StateCipher,
} from './state'
import {
  resolveTenant,
  TenantResolutionError,
  type ProviderOfLogin,
  type TenantLookup,
  type TenantOfLogin,
} from './tenant'
import type { ProviderDriver, ProviderIdentity } from './provider-driver'

/** The failure of a login. */
export class LoginError extends Error {
  constructor(
    /** The code of the failure. */
    readonly code:
      | 'invalid_request'
      | 'login_state_invalid'
      | 'identity_rejected'
      | 'identity_unknown'
      | 'principal_disabled'
      | 'tenant_disabled'
      | 'upstream_unavailable',
    message: string
  ) {
    super(message)
    this.name = 'LoginError'
  }
}

/** The request of an authorization. */
export interface AuthorizationRequest {
  clientId: string
  redirectUri: string
  /** The state of the gateway. */
  state: string
  /** The nonce of the gateway. */
  nonce?: string
  /** The scopes of the request. */
  scopes: string[]
  /** The tenant that the request names, when it names one. */
  tenant?: string
  /**
   * The provider of the tenant that the request names, when it names one.
   *
   * The provider is always a provider of the tenant of the login: the
   * parameter chooses between the providers of one tenant, and it never
   * moves a login to another one (spec §5.2).
   */
  provider?: string
  /** The hint of the caller, when there is one. */
  loginHint?: string
  /** The challenge of the PKCE of the gateway, when there is one. */
  codeChallenge?: string
}

/** The beginning of a login. */
export type BegunLogin =
  | {
      /** The browser is sent to the provider of the tenant. */
      kind: 'redirect'
      /** The url of the provider of the tenant. */
      url: string
      /** The value of the cookie of the state. */
      cookie: string
      /** The slug of the tenant of the login. */
      tenant: string
    }
  | {
      /**
       * The browser is sent to the page of a local provider.
       *
       * The page is served by Access itself: the caller signs in with an
       * address and a password, and the state of the login travels in a
       * cookie of its own (spec §5.4).
       */
      kind: 'local'
      /** The url of the page of the password. */
      url: string
      /** The value of the cookie of the state. */
      cookie: string
      /** The slug of the tenant of the login. */
      tenant: string
    }
  | {
      /**
       * The caller chooses between the providers of the tenant.
       *
       * A tenant that signs its people in at several providers is a
       * tenant whose login asks the caller which one it signs in at
       * (spec §5.2.1). The choice is the caller's, and it is made by the
       * browser: no state is written before it.
       */
      kind: 'choose'
      /** The slug of the tenant of the login. */
      tenant: string
      /** The providers the caller may sign in at. */
      providers: ProviderChoice[]
    }

/** A provider the caller may sign in at. */
interface ProviderChoice {
  /** The slug of the provider: the handle a login names. */
  slug: string
  /** The name shown to a human. */
  displayName: string
}

/** The end of a login. */
export interface CompletedLogin {
  principal: Principal
  tenant: TenantOfLogin
  /**
   * The client id of the request: the client that began the login.
   *
   * It is not always the client id of the tenant of the login: with a
   * shared client, the tenant of the login may be another one, and the
   * code and the audience belong to the client that presented the
   * client id (spec §5.2).
   */
  clientId: string
  /** The redirect uri of the login. */
  redirectUri: string
  /** The challenge of the PKCE of the gateway, when there is one. */
  codeChallenge?: string
  /** The state of the gateway, to be sent back with the code. */
  state: string
  /** The nonce of the login, when there was one. */
  nonce?: string
  /** The scopes of the request. */
  scopes: string[]
  /** True when the principal was created by this login. */
  created: boolean
  /**
   * True when the principal is the first of its tenant.
   *
   * The tenant had no principal at all before this login: a tenant that
   * hands its administration to its first identity gives it to that
   * principal (spec §6.4).
   */
  first: boolean
}

export interface LoginOptions {
  /** The storage of the tenants. */
  tenants: TenantLookup
  /** The storage of the principals. */
  principals: PrincipalLookup
  /** The cipher of the state of a login. */
  state: StateCipher
  /**
   * The driver of a provider of a tenant.
   *
   * The driver owns the exchange with the provider: the url of the
   * authorization and the identity that comes back from it (spec §5.4).
   */
  driverOf: (tenant: TenantOfLogin, provider: ProviderOfLogin) => Promise<ProviderDriver>
  /** The secret of the deployment, for the binding of the state. */
  secret: string
}

/** The login of the callers. */
export class LoginService {
  constructor(private readonly options: LoginOptions) {}

  /**
   * Starts a login.
   *
   * The tenant of the login is resolved, the state of the login is
   * created and the browser is sent to the provider of the tenant.
   */
  async begin(request: AuthorizationRequest): Promise<BegunLogin> {
    const tenant = await this.resolve(request)
    const provider = choiceOf(tenant, request.provider)
    if (!provider) {
      // The tenant signs its people in at several providers and the
      // request names none: the caller chooses (spec §5.2.1).
      return {
        kind: 'choose',
        tenant: tenant.slug,
        providers: tenant.providers
          .filter((candidate) => candidate.enabled)
          .map((candidate) => ({
            slug: candidate.slug,
            displayName: candidate.displayName,
          })),
      }
    }
    const verifier = aVerifier()
    const nonce = request.nonce ?? aNonce()
    const state: LoginState = {
      tenant: tenant.slug,
      provider: provider.slug,
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      state: request.state ?? '',
      nonce,
      verifier,
      scopes: request.scopes,
      ...(request.codeChallenge ? { codeChallenge: request.codeChallenge } : {}),
      startedAt: Date.now(),
    }
    const cookie = this.options.state.encrypt(state)
    const driver = await this.options.driverOf(tenant, provider)
    let url: string
    try {
      url = await driver.authorizationUrl({
        state: this.providerStateOf(state),
        nonce,
        challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url'),
        scopes: providerScopesOf(provider, request.scopes),
      })
    } catch (error) {
      throw this.refusalOf(error)
    }
    // A local provider is served by Access itself: the browser goes to
    // the page of the password, and the state of the login travels in a
    // cookie of its own (spec §5.4).
    if (provider.kind === 'local') {
      return { kind: 'local', url, cookie, tenant: tenant.slug }
    }
    return { kind: 'redirect', url, cookie, tenant: tenant.slug }
  }

  /**
   * Finishes a login.
   *
   * The state cookie is read and deleted, the code is exchanged at the
   * provider, the id token is validated and the external identity is
   * mapped to a principal.
   */
  async complete(options: {
    cookie: string | undefined
    providerState: string
    code: string
    /**
     * The facts of the call, for the audit of the principal that the
     * login creates (spec §10.1).
     */
    facts?: { address: string; requestId?: string }
  }): Promise<CompletedLogin> {
    if (!options.cookie) {
      throw new LoginError('login_state_invalid', 'the state of the login is missing')
    }
    let state: LoginState
    try {
      state = this.options.state.decrypt(options.cookie)
    } catch (error) {
      if (error instanceof LoginStateError) {
        throw new LoginError('login_state_invalid', 'the state of the login is not readable')
      }
      throw error
    }
    if (!isAlive(state)) {
      throw new LoginError('login_state_invalid', 'the state of the login is too old')
    }
    if (!this.sameProviderState(state, options.providerState)) {
      throw new LoginError('login_state_invalid', 'the state of the provider does not match')
    }

    const tenant = await this.options.tenants.findBySlug(state.tenant)
    if (!tenant) {
      throw new LoginError('login_state_invalid', 'the tenant of the login does not exist')
    }
    if (!tenant.enabled) {
      throw new LoginError('tenant_disabled', 'the tenant of the login is disabled')
    }

    // The provider of the login is the one the state names: the callback
    // does not carry it, and the state is what tells the login which
    // provider is waiting for the code (spec §5.3).
    const provider = providerOf(tenant, state.provider || undefined)
    const driver = await this.options.driverOf(tenant, provider)
    let identity: ProviderIdentity
    try {
      identity = await driver.exchange({
        code: options.code,
        verifier: state.verifier,
        nonce: state.nonce,
      })
    } catch (error) {
      if (error instanceof ProviderError) {
        throw this.refusalOf(error)
      }
      throw error
    }

    let mapping: Mapping
    try {
      mapping = await mapIdentity(
        this.options.principals,
        tenant,
        { slug: provider.slug, kind: provider.kind },
        identity,
        options.facts
      )
    } catch (error) {
      if (error instanceof MappingError) {
        throw new LoginError(error.code, error.message)
      }
      throw error
    }

    return {
      principal: mapping.principal,
      tenant,
      clientId: state.clientId,
      redirectUri: state.redirectUri,
      ...(state.codeChallenge ? { codeChallenge: state.codeChallenge } : {}),
      state: state.state,
      nonce: state.nonce,
      scopes: state.scopes,
      created: mapping.created,
      first: mapping.first,
    }
  }

  /**
   * The redirect uri of the state of a login.
   *
   * It is read when the provider refuses the login: the answer of the
   * provider is passed to the browser, unchanged, and it goes back to the
   * gateway.
   */
  async redirectUriOf(cookie: string | undefined): Promise<string | null> {
    const state = this.readState(cookie)
    return state?.redirectUri ?? null
  }

  /**
   * The tenant of the state of a login.
   *
   * It is read when the login is refused: the metric of the logins
   * counts the refusals per tenant, and the tenant of the login is what
   * the state cookie holds.
   */
  async tenantOf(cookie: string | undefined): Promise<string | null> {
    const state = this.readState(cookie)
    return state?.tenant ?? null
  }

  /** The state of the gateway of the state of a login. */
  async stateOf(cookie: string | undefined): Promise<string | null> {
    const state = this.readState(cookie)
    return state?.state ?? null
  }

  /** Reads the state of a login, when it is readable. */
  private readState(cookie: string | undefined): LoginState | null {
    if (!cookie) return null
    try {
      return this.options.state.decrypt(cookie)
    } catch {
      return null
    }
  }

  /** Turns the failure of the provider into a refusal of the login. */
  private refusalOf(error: unknown): LoginError {
    if (error instanceof ProviderError) {
      if (error.code === 'upstream_unavailable') {
        return new LoginError('upstream_unavailable', 'the provider of the tenant is not reachable')
      }
      return new LoginError('identity_rejected', 'the provider of the tenant was refused')
    }
    return error instanceof LoginError
      ? error
      : new LoginError('identity_rejected', 'the provider of the tenant was refused')
  }

  /** Resolves the tenant of a login and turns the failures into refusals. */
  private async resolve(request: AuthorizationRequest): Promise<TenantOfLogin> {
    try {
      return await resolveTenant(this.options.tenants, {
        clientId: request.clientId,
        redirectUri: request.redirectUri,
        tenant: request.tenant,
        loginHint: request.loginHint,
      })
    } catch (error) {
      if (error instanceof TenantResolutionError) {
        throw new LoginError(error.code, error.message)
      }
      throw error
    }
  }

  /**
   * The state of the provider.
   *
   * It is bound to the state cookie: it is derived from the fields of the
   * state and from the secret of the deployment, so it cannot be forged
   * and it does not have to be carried by the cookie. It is bound to the
   * provider too: a code that was minted for one provider is not a code
   * for another one.
   */
  private providerStateOf(state: LoginState): string {
    return createHmac('sha256', this.options.secret)
      .update(`${state.tenant}:${state.provider}:${state.startedAt}:${state.nonce}`)
      .digest('base64url')
  }

  /** Reports whether the state of the provider is the one of the login. */
  private sameProviderState(state: LoginState, received: string): boolean {
    return this.providerStateOf(state) === received
  }
}

/**
 * The scopes that belong to the platform and not to the provider.
 *
 * `offline_access` asks for a refresh token of Access (§7.6): no
 * provider of a tenant knows it, and a provider that is asked for a
 * scope it does not know refuses the whole login.
 */
const PLATFORM_SCOPES = ['offline_access']

/**
 * The scopes Access asks the provider for.
 *
 * The scopes of a request are the scopes of the **platform**: `groups` is
 * one of them, and the groups of a caller are read in the grants of
 * Access. The scopes of a **provider** are the ones its registration
 * carries, and the ones its discovery document names: a scope a provider
 * does not name is a scope its authorization refuses, and the whole
 * login is refused with it.
 *
 * The two lists are not the same list, and Access keeps them apart: the
 * platform asks for the groups of a caller, and the provider of a tenant
 * that has no directory of groups is not asked for them.
 *
 * A tenant whose registration carries no scope is asked for the scopes
 * of the request: a provider that knows no scope is a provider that is
 * asked what the caller asked for.
 *
 * @param provider the provider of the login.
 * @param requested the scopes the client asked for.
 */
export function providerScopesOf(
  provider: ProviderOfLogin,
  requested: readonly string[]
): string[] {
  const asked = requested.filter((scope) => !PLATFORM_SCOPES.includes(scope))
  const known = provider.scopes
  if (known.length === 0) return [...asked]
  const named = asked.filter((scope) => known.includes(scope))
  return named.length > 0 ? named : [...known]
}

/**
 * The provider of a login (spec §5.2).
 *
 * The provider named by the request wins, when it names one that belongs
 * to the tenant of the login and is enabled. A request that names no
 * provider is a request at the only provider of the tenant, and a tenant
 * that has several is a tenant whose caller chooses (spec §5.2.1).
 *
 * A tenant that has no provider, or whose providers are all disabled,
 * refuses every login: `invalid_request` is the answer of a tenant that
 * cannot sign anybody in.
 *
 * @param tenant the tenant of the login.
 * @param requested the provider the request names, when it names one.
 */
export function providerOf(tenant: TenantOfLogin, requested?: string): ProviderOfLogin {
  const provider = choiceOf(tenant, requested)
  if (!provider) {
    throw new LoginError(
      'invalid_request',
      'the tenant of the login has several providers and the request names none'
    )
  }
  return provider
}

/**
 * The provider of a login, when there is one (spec §5.2.1).
 *
 * The provider named by the request wins, when it names one that belongs
 * to the tenant of the login and is enabled. A request that names no
 * provider is a request at the only provider of the tenant: a tenant
 * that has several is a tenant whose caller chooses, and the choice is
 * the caller's.
 *
 * A slug that names no enabled provider of the tenant is refused: the
 * parameter names a provider of the tenant of the login and nothing else.
 *
 * @param tenant the tenant of the login.
 * @param requested the provider the request names, when it names one.
 */
function choiceOf(tenant: TenantOfLogin, requested?: string): ProviderOfLogin | null {
  const providers = tenant.providers.filter((provider) => provider.enabled)
  if (requested !== undefined && requested !== '') {
    const named = providers.find((provider) => provider.slug === requested)
    if (!named) {
      throw new LoginError(
        'invalid_request',
        'the provider of the request does not belong to the tenant of the login'
      )
    }
    return named
  }
  if (providers.length === 1) return providers[0]!
  if (providers.length === 0) {
    throw new LoginError(
      'invalid_request',
      'the tenant of the login has no provider to sign the caller in at'
    )
  }
  return null
}
