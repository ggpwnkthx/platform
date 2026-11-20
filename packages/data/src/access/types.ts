/** What PostgreSQL says about the roles, the groups and the rights of the installation. */

export interface RoleInfo {
  name: string
  login: boolean
  inherit: boolean
  create_role: boolean
  bypass_rls: boolean
  superuser: boolean
  /** The reader may admit others to this role: ADMIN OPTION on it, or CREATEROLE. */
  admits: boolean
}

export interface MembershipInfo {
  role: string
  member: string
  admin_option: boolean
  inherit_option: boolean
  set_option: boolean
}

export interface PolicyInfo {
  schema: string
  table: string
  name: string
  permissive: string
  roles: string[]
  command: string
  using: string | null
  check: string | null
}

/** One grant on a table or a column, as the ACL records it. */
export interface GrantInfo {
  schema: string
  table: string
  /** Null for a grant on the whole table. */
  column: string | null
  grantee: string
  privilege: string
  grantor: string
  grantable: boolean
}

/** How much of a privilege a role holds: the whole collection, some of its fields, or none. */
export type Hold = 'all' | 'some' | 'none'

/**
 * What one role may do with one collection, as PostgreSQL answers for that role: through
 * its own grants, through the groups whose rights it inherits, and through PUBLIC.
 */
export interface ReachInfo {
  role: string
  table: string
  /** USAGE on the workspace: without it no grant on a collection inside is of any use. */
  usage: boolean
  select: Hold
  insert: Hold
  update: Hold
  references: Hold
  delete: boolean
  truncate: boolean
  trigger: boolean
}

/** What one role may do with a workspace's own schema, as PostgreSQL answers for that role. */
export interface SchemaReachInfo {
  role: string
  usage: boolean
  create: boolean
}
