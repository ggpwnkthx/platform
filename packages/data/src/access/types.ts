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
