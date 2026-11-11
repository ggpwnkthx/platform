/**
 * The login of a caller (spec §5.4).
 *
 * The browser logs in at the provider of a tenant and comes back with a
 * principal. The service owns the two halves of the flow: it starts the
 * login and it finishes it.
 */

import { createHash } from 'node:crypto'
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
import { providerStateOf } from './provider-state'
import {
  DEFAULT_PROVIDER_SLUG,
  resolveTenant,
  TenantResolutionError,
  type ProviderOfLogin,
  type RouteLookup,
  type TenantLookup,
  type TenantOfLogin,
  type TenantResolution,
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
    message: string,
    /**
     * The reason of the refusal.
     *
     * It names the failure of the provider or the check of the token that
     * failed: it is in the log of the service and never in the answer of
     * the browser (spec §5.6).
     */
    readonly reason?: string
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
  | {
      /**
       * The caller is asked for the address of the login.
       *
       * A shared client serves several tenants, and the address of the
       * caller is what names the tenant of the login (spec §5.2.2). The
       * page is served by Access itself, and the state of the login
       * travels in a cookie of its own.
       */
      kind: 'discover'
      /** The value of the cookie of the state. */
      cookie: string
      /** The slug of the tenant that owns the client of the login. */
      tenant: string
    }

/** A provider the caller may sign in at. */
interface ProviderChoice {
  /** The slug of the provider: the handle a login names. */
  slug: string
  /** The name shown to a human. */
  displayName: string
}

/**
 * The form of the page of the address (spec §5.2.2).
 *
 * The form carries the token of the state, and the token is bound to the
 * state of the login: a form that carries another one is a form of no
 * login.
 */
export interface DiscoveryForm {
  /** The token of the form: the state of the provider. */
  token: string
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
  /** The storage of the routes of the logins (spec §3.13). */
  routes: RouteLookup
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
   *
   * A shared client that names no tenant is a client that serves several
   * tenants: the login asks the caller for the address of the login, and
   * the address names the tenant (spec §5.2.2).
   */
  async begin(request: AuthorizationRequest): Promise<BegunLogin> {
    const resolution = await this.resolve(request)
    if (resolution.discovery) {
      return {
        kind: 'discover',
        cookie: this.options.state.encrypt(this.pendingOf(request, resolution.client)),
        tenant: resolution.client.slug,
      }
    }
    const tenant = resolution.tenant
    // A tenant that signs its people in at several providers asks the
    // caller for the address of the login: the address of the caller is
    // what names the provider the caller signs in at (spec §5.2.1).
    if (
      resolution.provider === undefined &&
      request.provider === undefined &&
      request.loginHint === undefined &&
      enabledOf(tenant).length > 1
    ) {
      return {
        kind: 'discover',
        cookie: this.options.state.encrypt(this.pendingOf(request, tenant)),
        tenant: tenant.slug,
      }
    }
    const provider = choiceOf(tenant, request.provider, resolution.provider)
    if (!provider) {
      // The tenant signs its people in at several providers, it has no
      // default one and the request names none: the caller chooses
      // (spec §5.2.1).
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
        state: providerStateOf(state, this.options.secret),
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
        throw new LoginError(
          error.code,
          error.message,
          error.subject ? `the subject of the refused identity is ${error.subject}` : undefined
        )
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

  /**
   * Turns the failure of the provider into a refusal of the login.
   *
   * The reason of the failure is carried by the refusal, and it is in the
   * log of the service: the answer of the browser names what happened and
   * nothing else (spec §5.6).
   *
   * A failure that is not a refusal of the provider is not a refusal at
   * all: it is raised again, and the service answers `internal_error`
   * with the failure in its log.
   */
  private refusalOf(error: unknown): LoginError {
    if (error instanceof ProviderError) {
      if (error.code === 'upstream_unavailable') {
        return new LoginError(
          'upstream_unavailable',
          'the provider of the tenant is not reachable',
          error.message
        )
      }
      return new LoginError(
        'identity_rejected',
        'the provider of the tenant was refused',
        error.message
      )
    }
    if (error instanceof LoginError) {
      return error
    }
    throw error
  }

  /** Resolves the tenant of a login and turns the failures into refusals. */
  private async resolve(request: AuthorizationRequest): Promise<TenantResolution> {
    try {
      return await resolveTenant(this.options.tenants, this.options.routes, {
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
   * The state of a login that waits for the address of the caller.
   *
   * The provider is empty: the address of the caller is what names the
   * tenant of the login and the provider of that tenant (spec §5.2.2).
   */
  private pendingOf(request: AuthorizationRequest, tenant: TenantOfLogin): LoginState {
    return {
      tenant: tenant.slug,
      provider: '',
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      state: request.state ?? '',
      nonce: request.nonce ?? aNonce(),
      verifier: aVerifier(),
      scopes: request.scopes,
      ...(request.codeChallenge ? { codeChallenge: request.codeChallenge } : {}),
      startedAt: Date.now(),
    }
  }

  /**
   * The request of a login that is in flight.
   *
   * The parameters of the request are the ones the caller of the gateway
   * sent, and the page of the choice of a provider carries them back to
   * the authorization (spec §5.2.1).
   *
   * @param cookie the cookie of the state of the login.
   */
  requestOf(cookie: string | undefined): AuthorizationRequest | null {
    const state = this.readState(cookie)
    if (!state) return null
    return {
      clientId: state.clientId,
      redirectUri: state.redirectUri,
      state: state.state,
      nonce: state.nonce,
      scopes: state.scopes,
      ...(state.codeChallenge ? { codeChallenge: state.codeChallenge } : {}),
    }
  }

  /**
   * The form of the page of the address.
   *
   * The form is written for a login that is in flight: the cookie of the
   * state names the client of the login, and the token of the form is the
   * state of the provider (spec §5.2.2).
   *
   * @param cookie the cookie of the state of the login.
   */
  discoveryForm(cookie: string | undefined): DiscoveryForm {
    const state = this.readState(cookie)
    if (!state) {
      throw new LoginError('login_state_invalid', 'the state of the login is not readable')
    }
    return { token: providerStateOf(state, this.options.secret) }
  }

  /**
   * Continues a login that asked for the address of the caller.
   *
   * The address of the caller is the hint of the login: the domain of
   * the address names the tenant of the login, and the provider of that
   * tenant is the one the login signs in at (spec §5.2.2).
   *
   * @param options the cookie of the state, the address and the token of
   *   the form.
   */
  async discover(options: {
    cookie: string | undefined
    address: string
    token: string
  }): Promise<BegunLogin> {
    const state = this.readState(options.cookie)
    if (!state) {
      throw new LoginError('login_state_invalid', 'the state of the login is not readable')
    }
    if (!isAlive(state)) {
      throw new LoginError('login_state_invalid', 'the state of the login is too old')
    }
    if (providerStateOf(state, this.options.secret) !== options.token) {
      throw new LoginError('login_state_invalid', 'the token of the form does not match')
    }
    return await this.begin({
      clientId: state.clientId,
      redirectUri: state.redirectUri,
      state: state.state,
      nonce: state.nonce,
      scopes: state.scopes,
      ...(state.codeChallenge ? { codeChallenge: state.codeChallenge } : {}),
      loginHint: options.address,
    })
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

  /** Reports whether the state of the provider is the one of the login. */
  private sameProviderState(state: LoginState, received: string): boolean {
    return providerStateOf(state, this.options.secret) === received
  }
}

/**
 * The providers of a tenant that are asked to sign somebody in.
 *
 * A disabled provider signs nobody in, and it is not one of them.
 *
 * @param tenant the tenant of the login.
 */
function enabledOf(tenant: TenantOfLogin): ProviderOfLogin[] {
  return tenant.providers.filter((provider) => provider.enabled)
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
 * provider is a request at the **default** provider of the tenant: the
 * one whose slug is `default`. A tenant whose default provider is
 * disabled or missing, and that has exactly one enabled provider, is a
 * tenant with that provider.
 *
 * A tenant whose providers are several and that has no default one is a
 * tenant whose caller chooses: the choice is the caller's, and it is
 * made by the browser (spec §5.2.1).
 *
 * A slug that names no enabled provider of the tenant is refused: the
 * parameter names a provider of the tenant of the login and nothing else.
 *
 * @param tenant the tenant of the login.
 * @param requested the provider the request names, when it names one.
 */
function choiceOf(
  tenant: TenantOfLogin,
  requested?: string,
  routed?: ProviderOfLogin
): ProviderOfLogin | null {
  const providers = enabledOf(tenant)
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
  // The route of the address names the provider of the login: the
  // address of the caller is what names it (spec §5.2.1).
  if (routed !== undefined && providers.some((provider) => provider.slug === routed.slug)) {
    return routed
  }
  // The default provider of the tenant is the one its own registration
  // names: it answers the address that names no route (spec §5.2.1).
  const fallback = providers.find((provider) => provider.slug === DEFAULT_PROVIDER_SLUG)
  if (fallback) return fallback
  if (providers.length === 1) return providers[0]!
  if (providers.length === 0) {
    throw new LoginError(
      'invalid_request',
      'the tenant of the login has no provider to sign the caller in at'
    )
  }
  return null
}
