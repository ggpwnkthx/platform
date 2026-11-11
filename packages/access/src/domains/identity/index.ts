/**
 * The identity of the callers.
 *
 * The domain owns the validation of the token of the provider of a tenant,
 * the mapping of the external identity `(tenant, subject)` to a principal
 * and the resolution of the tenant of a login.
 */

export type { Principal } from './mapping'
export type {
  CallTarget,
  HttpTransport,
  TransportResponse,
} from './provider-client'
export { ProviderClient } from './provider-client'
export { mapIdentity, MappingError } from './mapping'
export { LocalAuthenticator, LocalLoginError } from './local-authenticator'
export {
  LocalProvider,
  type CredentialLookup,
  type LocalCodeRecord,
  type LocalCredential,
  type PasswordHasher,
} from './local-provider'

export type {
  AuthorizationRequest,
  BegunLogin,
  CompletedLogin,
} from './service'
export { LoginError, LoginService } from './service'
export { providerOf, providerScopesOf } from './service'
export type { LoginState } from './state'
export {
  aChallenge,
  aVerifier,
  createStateCipher,
  isAlive,
  LoginStateError,
} from './state'
export type { ProviderOfLogin, TenantOfLogin } from './tenant'
export { domainOf, resolveTenant, TenantResolutionError } from './tenant'

export { validateProviderToken } from './token'
