/**
 * The rows of the administration of Access, as its contract
 * answers them (docs/access/api.md).
 *
 * The shapes are written in the client of the platform
 * (`@platform/client`): the console and the CLI read the same
 * contracts, and a shape that is written twice is a shape that drifts.
 */

export type {
  AccessContext,
  BatchOutcome,
  AdminPage,
  AuditRecord,
  Grant,
  GrantInput,
  Group,
  GroupInput,
  Principal,
  PrincipalInput,
  Role,
  RoleInput,
  Tenant,
  TenantInput,
} from '@platform/client'
