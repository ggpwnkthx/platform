/**
 * The administration of Access.
 *
 * The domain owns the twenty-one endpoints, the validation of their bodies and
 * the audit of every change. It is the whole administration surface of the
 * platform: there is no console and no second way to change a tenant, a
 * principal or a grant.
 */

export { AdministrationError } from './errors'
export type { AdminCredential, AdminScope } from './credentials'
export { PLATFORM_SCOPE } from './credentials'
export { FailedAuthenticationLimiter } from './limiter'
export type {
  AuthenticationFailures,
  FailureCount,
} from './limiter'
export type {
  AuditContext,
  AuditFilter,
  AuditRecord,
  AuditRows,
  AuditStore,
  ChangeAudit,
  Credential,
  CredentialFilter,
  CredentialHasher,
  CredentialStore,
  Grant,
  GrantFilter,
  Group,
  GroupFilter,
  GroupStore,
  GrantStore,
  PermissionStore,
  PrincipalFilter,
  Principal,
  PrincipalStore,
  Provider,
  ProviderFilter,
  ProviderStore,
  DomainProof,
  Route,
  RouteStore,
  Role,
  RoleFilter,
  RoleStore,
  Scope,
  Tenant,
  TenantStore,
} from './ports'
export { platformScope, scopeOf, tenantScope } from './ports'
export {
  CredentialBody,
  GrantBatchBody,
  GrantBody,
  GroupBody,
  PrincipalBatchBody,
  PrincipalBody,
  ProviderBody,
  RoleBody,
  RouteBody,
  RouteVerificationBody,
  TenantBody,
} from './schemas'
export {
  AdministrationService,
  type AuditEntry,
} from './service'
export { change } from './audit'
export { DEFAULT_PROVIDER_SLUG } from './values'
export { TENANT_ADMIN_PERMISSION } from './bootstrap'
