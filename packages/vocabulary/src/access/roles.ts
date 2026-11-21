import { role } from '../core.ts'
import { InvalidName } from '../errors.ts'

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
