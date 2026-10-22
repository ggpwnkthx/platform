/**
 * The administration of the access service.
 *
 * The domain owns the twelve endpoints, the validation of their bodies and
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
  Role,
  RoleFilter,
  RoleStore,
  Tenant,
  TenantStore,
} from './ports'
export {
  GrantBatchBody,
  GrantBody,
  GroupBody,
  PrincipalBatchBody,
  PrincipalBody,
  RoleBody,
  TenantBody,
} from './schemas'
export {
  AdministrationService,
  type AuditEntry,
} from './service'
