/**
 * The ports of the administration.
 *
 * The domain owns the rules of the twenty-one endpoints; the storage is a port
 * that the composition root fulfils. The domain knows nothing about
 * PostgreSQL and nothing about the shape of the rows.
 *
 * Every resource has its own port: the tenants, the principals, the
 * permissions, the groups, the grants and the audit.
 */

export type {
  Credential,
  CredentialFilter,
  CredentialHasher,
  CredentialPage,
  CredentialRegistration,
  CredentialStore,
} from './local-credentials'
export type {
  AuditContext,
  AuditFilter,
  AuditFormat,
  AuditPage,
  AuditRecord,
  AuditRows,
  AuditStore,
  ChangeAudit,
} from './audit'
export { platformScope, scopeOf, tenantScope, type Scope } from './scope'
export type { Grant, GrantFilter, GrantPage, GrantRegistration, GrantStore } from './grants'
export type { Group, GroupFilter, GroupPage, GroupRegistration, GroupStore } from './groups'
export type { Permission, PermissionStore } from './permissions'
export type { Role, RoleFilter, RolePage, RoleRegistration, RoleStore } from './roles'
export type {
  Principal,
  PrincipalFilter,
  PrincipalPage,
  PrincipalRegistration,
  PrincipalStore,
} from './principals'
export type {
  Provider,
  ProviderFilter,
  ProviderPage,
  ProviderRegistration,
  ProviderStore,
} from './providers'
export type {
  DomainProof,
  Route,
  RouteFilter,
  RouteKind,
  RoutePage,
  RouteRegistration,
  RouteStatus,
  RouteStore,
  RouteVerification,
} from './routes'
export type {
  Tenant,
  TenantCreation,
  TenantRegistration,
  TenantStore,
  TenantSummary,
} from './tenants'
