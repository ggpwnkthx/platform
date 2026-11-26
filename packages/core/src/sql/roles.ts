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

/**
 * A role's attributes, as an operator changes them: only what differs from what it holds.
 * VALID UNTIL is not among them: it ends a password, and no role here has one.
 */
export interface RoleAttributes {
  login: boolean
  create_role: boolean
  inherit: boolean
  connection_limit: number
}
export function roleAttributesStatement(name: string, held: RoleAttributes, asked: RoleAttributes) {
  const words: string[] = []
  const flag = (key: 'login' | 'create_role' | 'inherit', word: string) => {
    if (!!asked[key] !== !!held[key]) words.push(asked[key] ? word : `NO${word}`)
  }
  flag('login', 'LOGIN')
  flag('create_role', 'CREATEROLE')
  flag('inherit', 'INHERIT')
  const limit = Number(asked.connection_limit ?? -1)
  if (!Number.isInteger(limit) || limit < -1)
    throw new InvalidName('A connection limit is a whole number, or -1 for none.')
  if (limit !== held.connection_limit) words.push(`CONNECTION LIMIT ${limit}`)
  if (!words.length) return null
  return stmt`ALTER ROLE ${id(name)} WITH ${sql.raw(words.join(' '))}`
}
