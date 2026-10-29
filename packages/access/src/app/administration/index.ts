/**
 * The administrative endpoints of Access (spec §10).
 *
 * The handlers are thin: they authenticate the call, they validate the
 * body, they ask the administration domain and they write the answer. The
 * rules live in the domain.
 *
 * Every resource of the administration has its own file: the tenants,
 * the principals, the groups, the grants and the audit. The parts that
 * they share live in `support.ts`.
 */

export { auditHandler } from './audit'
export { grantHandler, grantsHandler, revokeGrantHandler } from './grants'
export { groupHandler, groupsHandler } from './groups'
export { principalHandler, principalsHandler } from './principals'
export { removeRoleHandler, roleHandler, rolesHandler } from './roles'
export { tenantHandler, tenantsHandler } from './tenants'
