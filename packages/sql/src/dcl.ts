import { ident, qualified, role } from './core.ts'
import { InvalidName } from './errors.ts'

/**
 * The access the platform grants, written once.
 *
 * A privilege, a row policy, a membership and a role are the same things whether the
 * operator's tools grant them from a manifest or the interface grants them in the browser:
 * the same statement, with the same rules about what may be limited to which fields. The
 * operator's tools converge a database on a manifest; the interface shows the reader the
 * statement before it runs. The statement itself is written here, once, so that the two
 * cannot drift apart.
 */

/** The privileges a collection may carry, as PostgreSQL writes them. */
export const tablePrivileges = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
] as const

/**
 * The privileges PostgreSQL may limit to fields. The others always cover the whole
 * collection: a row that may be deleted is deleted whatever its fields say.
 */
export const columnPrivileges = ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] as const

/** The privileges a workspace's schema may carry. */
export const schemaPrivileges = ['USAGE', 'CREATE'] as const

/**
 * The same privileges as a manifest writes them, in lower case. A manifest is written by
 * hand, and PostgreSQL writes its privileges in capitals; these are the two spellings of
 * one vocabulary, kept side by side so that they cannot drift apart.
 */
export const tablePrivilegeNames = [
  'select',
  'insert',
  'update',
  'delete',
  'truncate',
  'references',
  'trigger',
  'all',
] as const

export const schemaPrivilegeNames = ['usage', 'create', 'all'] as const

export const columnPrivilegeNames = ['select', 'insert', 'update', 'references'] as const

/** Every privilege at once. PostgreSQL takes no field list with it. */
export const allPrivileges = 'ALL PRIVILEGES'

/** A privilege as PostgreSQL writes it, whatever case it was written in. */
export function privilege(name: string): string {
  const upper = name.trim().toUpperCase()
  if (upper === 'ALL') return allPrivileges
  return upper
}

/** Who a statement names: PUBLIC is PostgreSQL's own word for everyone. */
export function grantee(name: string): string {
  const who = name.trim()
  if (!who) throw new InvalidName('Choose who receives it')
  return who.toLowerCase() === 'public' ? 'PUBLIC' : role(who)
}

/** The actions a relation's foreign key may take when the row it points at goes. */
export const onDeleteActions = ['restrict', 'cascade', 'set_null'] as const

export type OnDelete = (typeof onDeleteActions)[number]

/** The action as a statement writes it. */
export const onDeleteAction = (action: OnDelete): string =>
  ({ restrict: 'RESTRICT', cascade: 'CASCADE', set_null: 'SET NULL' })[action]

export interface GrantDraft {
  schema: string
  /** The collection; null when the grant is on the workspace's schema itself. */
  table: string | null
  privileges: string[]
  /** The fields a grant is limited to; empty for the whole collection. */
  columns: string[]
  /** Who receives the grant: one role, or several. */
  grantee: string | string[]
  withGrantOption: boolean
}

/**
 * A grant, or the revocation of one. A field list may only narrow the privileges
 * PostgreSQL allows it to narrow; the others cover the whole collection, and every
 * privilege at once cannot be narrowed at all — it would grant more than was asked for.
 */
export function grantStatement(draft: GrantDraft, revoke = false): string {
  const privileges = draft.privileges.map(privilege)
  if (!privileges.length) throw new InvalidName('Choose at least one privilege')
  const who = (Array.isArray(draft.grantee) ? draft.grantee : [draft.grantee]).map(grantee)
  if (!who.length) throw new InvalidName('Choose who receives it')
  const columns = draft.columns.map(ident)
  if (columns.length) {
    if (!draft.table) throw new InvalidName('Fields belong to a collection')
    if (privileges.includes(allPrivileges))
      throw new InvalidName(
        'Every privilege cannot be limited to fields: name the privileges themselves.'
      )
  }
  const narrowable = new Set<string>(columnPrivileges)
  const list = privileges
    .map((p) => (columns.length && narrowable.has(p) ? `${p} (${columns.join(', ')})` : p))
    .join(', ')
  const object = draft.table
    ? `TABLE ${qualified(draft.schema, draft.table)}`
    : `SCHEMA ${ident(draft.schema)}`
  const roles = who.join(', ')
  return revoke
    ? `REVOKE ${list} ON ${object} FROM ${roles};`
    : `GRANT ${list} ON ${object} TO ${roles}${draft.withGrantOption ? ' WITH GRANT OPTION' : ''};`
}

export type PolicyCommand = 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

/** The commands a row policy may be written for. */
export const policyCommands: PolicyCommand[] = ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE']

export interface PolicyDraft {
  schema: string
  table: string
  name: string
  permissive: boolean
  command: PolicyCommand
  roles: string[]
  using: string
  check: string
}

/** A policy for INSERT carries no USING: there is no old row to read. */
export const policyReads = (command: PolicyCommand): boolean => command !== 'INSERT'

/** A policy for SELECT or DELETE carries no WITH CHECK: no row is written. */
export const policyChecks = (command: PolicyCommand): boolean =>
  command !== 'SELECT' && command !== 'DELETE'

/**
 * A row policy. PostgreSQL decides which clause a policy may carry: one for INSERT has only
 * a WITH CHECK, one for SELECT or DELETE has only a USING, and one for UPDATE or ALL has
 * both. A policy with neither covers every row, which is what PostgreSQL writes by default.
 */
export function policyStatement(draft: PolicyDraft): string {
  if (!draft.name.trim()) throw new InvalidName('Name the policy')
  const roles = draft.roles.length ? draft.roles.map(grantee).join(', ') : 'PUBLIC'
  const lines = [
    `CREATE POLICY ${ident(draft.name.trim())} ON ${qualified(draft.schema, draft.table)}`,
    `  AS ${draft.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${draft.command} TO ${roles}`,
  ]
  const reads = policyReads(draft.command)
  const checks = policyChecks(draft.command)
  if (!reads && draft.using.trim())
    throw new InvalidName(
      `A policy for ${draft.command} cannot have a USING expression: there is no old row.`
    )
  if (!checks && draft.check.trim())
    throw new InvalidName(
      `A policy for ${draft.command} cannot have a WITH CHECK expression: no row is written.`
    )
  if (reads && draft.using.trim()) lines.push(`  USING (${draft.using.trim()})`)
  if (checks && draft.check.trim()) lines.push(`  WITH CHECK (${draft.check.trim()})`)
  return `${lines.join('\n')};`
}

/** The statement that removes a row policy. */
export function dropPolicyStatement(schema: string, table: string, name: string): string {
  return `DROP POLICY ${ident(name)} ON ${qualified(schema, table)};`
}

/** The statement that turns row security on a collection on or off. */
export function rowSecurityStatement(schema: string, table: string, enable: boolean): string {
  return `ALTER TABLE ${qualified(schema, table)} ${enable ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY;`
}

export interface MembershipDraft {
  role: string
  member: string
  admin: boolean
}

/** A membership: a group and the role that belongs to it. */
export function membershipStatement(draft: MembershipDraft, revoke = false): string {
  if (!draft.role || !draft.member) throw new InvalidName('Choose a group and a member')
  return revoke
    ? `REVOKE ${role(draft.role)} FROM ${role(draft.member)};`
    : `GRANT ${role(draft.role)} TO ${role(draft.member)}${draft.admin ? ' WITH ADMIN OPTION' : ''};`
}

export interface RoleDraft {
  name: string
  login: boolean
}

/** The statement that makes a role: a person who may sign in, or a group. */
export function createRoleStatement(draft: RoleDraft): string {
  if (!draft.name.trim()) throw new InvalidName('Name the role')
  return `CREATE ROLE ${role(draft.name.trim())} ${draft.login ? 'LOGIN' : 'NOLOGIN'};`
}

/** The group every person belongs to, without which a login may not reach the database. */
export const platformUsers = 'platform_users'

/**
 * The statements that make a person: the role, and the group that lets it connect. The
 * operator's tools grant that membership in their own way, so that an existing one is left
 * in place; this is what the interface offers.
 */
export function createRoleStatements(draft: RoleDraft): string[] {
  const name = role(draft.name.trim())
  const out = [createRoleStatement(draft)]
  if (draft.login) out.push(`GRANT ${platformUsers} TO ${name};`)
  return out
}
