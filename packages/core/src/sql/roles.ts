import { id, InvalidName, sql, stmt } from './kit.ts'

export const platformUsers = 'platform_users'
export const reservedRole = (role: string) =>
  /^(pg_.*|platform_core|platform_users|platform_admins)$/.test(role)
export function createRoleStatements(draft: { name: string; login: boolean }): string[] {
  const name = draft.name.trim()
  if (!name) throw new InvalidName('Name the role')
  const out = [stmt`CREATE ROLE ${id(name)} ${sql.raw(draft.login ? 'LOGIN' : 'NOLOGIN')}`]
  // A person can sign in once they belong to the platform's users.
  if (draft.login) out.push(stmt`GRANT ${id(platformUsers)} TO ${id(name)}`)
  return out
}
export const dropRoleStatement = (name: string) => stmt`DROP ROLE ${id(name)}`
export function membershipStatement(
  draft: { role: string; member: string; admin?: boolean },
  revoke = false
): string {
  if (!draft.role || !draft.member) throw new InvalidName('Choose a group and a member')
  return revoke
    ? stmt`REVOKE ${id(draft.role)} FROM ${id(draft.member)}`
    : stmt`GRANT ${id(draft.role)} TO ${id(draft.member)}${sql.raw(draft.admin ? ' WITH ADMIN OPTION' : '')}`
}
export const schemaStatement = (name: string, owner?: string | null) =>
  owner
    ? stmt`CREATE SCHEMA ${id(name)} AUTHORIZATION ${id(owner)}`
    : stmt`CREATE SCHEMA ${id(name)}`
