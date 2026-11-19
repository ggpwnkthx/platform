import { ident, InvalidName, qualified, role } from '@platform/sql'

/**
 * Access, written as the statements PostgreSQL runs. A grant, a row policy, a membership and
 * a role are all shown to the reader before they run, and then run as the reader, in one
 * transaction. PostgreSQL decides whether the reader may.
 */

export const tablePrivileges = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
] as const
export const columnPrivileges = ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] as const

export interface GrantDraft {
  schema: string
  table: string
  privileges: string[]
  /** Empty for the whole table. */
  columns: string[]
  grantee: string
  withGrantOption: boolean
}

export function grantStatement(draft: GrantDraft, revoke = false): string {
  if (!draft.privileges.length) throw new InvalidName('Choose at least one privilege')
  if (!draft.grantee) throw new InvalidName('Choose who receives it')
  const columns = draft.columns.length ? ` (${draft.columns.map(ident).join(', ')})` : ''
  const privileges = draft.privileges.map((p) => `${p}${columns}`).join(', ')
  const grantee = draft.grantee === 'PUBLIC' ? 'PUBLIC' : role(draft.grantee)
  const target = qualified(draft.schema, draft.table)
  return revoke
    ? `REVOKE ${privileges} ON ${target} FROM ${grantee};`
    : `GRANT ${privileges} ON ${target} TO ${grantee}${draft.withGrantOption ? ' WITH GRANT OPTION' : ''};`
}

export type PolicyCommand = 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

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

export function policyStatement(draft: PolicyDraft): string {
  if (!draft.name.trim()) throw new InvalidName('Name the policy')
  const roles = draft.roles.length
    ? draft.roles.map((r) => (r === 'PUBLIC' ? 'PUBLIC' : role(r))).join(', ')
    : 'PUBLIC'
  const lines = [
    `CREATE POLICY ${ident(draft.name.trim())} ON ${qualified(draft.schema, draft.table)}`,
    `  AS ${draft.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${draft.command} TO ${roles}`,
  ]
  const usable = draft.command !== 'INSERT'
  const checkable = draft.command !== 'SELECT' && draft.command !== 'DELETE'
  if (usable && draft.using.trim()) lines.push(`  USING (${draft.using.trim()})`)
  if (checkable && draft.check.trim()) lines.push(`  WITH CHECK (${draft.check.trim()})`)
  if (!(usable && draft.using.trim()) && !(checkable && draft.check.trim()))
    throw new InvalidName('A policy needs a USING or a WITH CHECK expression')
  return `${lines.join('\n')};`
}

export function dropPolicyStatement(schema: string, table: string, name: string): string {
  return `DROP POLICY ${ident(name)} ON ${qualified(schema, table)};`
}

export function rowSecurityStatement(schema: string, table: string, enable: boolean): string {
  return `ALTER TABLE ${qualified(schema, table)} ${enable ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY;`
}

export interface MembershipDraft {
  role: string
  member: string
  admin: boolean
}

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

export function createRoleStatements(draft: RoleDraft): string[] {
  if (!draft.name.trim()) throw new InvalidName('Name the role')
  const name = role(draft.name.trim())
  const out = [`CREATE ROLE ${name} ${draft.login ? 'LOGIN' : 'NOLOGIN'};`]
  // A person needs the platform's group to connect and read the helpers.
  if (draft.login) out.push(`GRANT platform_users TO ${name};`)
  return out
}
