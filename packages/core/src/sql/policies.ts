import { grantee, id, InvalidName, list, sql, stmt } from './kit.ts'

export const policyCommands = ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const
export type PolicyCommand = (typeof policyCommands)[number]
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
export const policyReads = (command: PolicyCommand) => command !== 'INSERT'
export const policyChecks = (command: PolicyCommand) => command !== 'SELECT' && command !== 'DELETE'

/**
 * The expressions are the owner's own SQL and are written as they are. PostgreSQL parses the
 * statement, and runs one statement only, so it is the judge of what an expression may hold.
 */
export function policyStatement(draft: PolicyDraft): string {
  const name = draft.name.trim()
  const using = draft.using.trim()
  const check = draft.check.trim()
  if (!name) throw new InvalidName('Name the policy')
  if (!policyCommands.includes(draft.command)) throw new InvalidName('Unknown policy command')
  if (using && !policyReads(draft.command))
    throw new InvalidName(`A policy for ${draft.command} has no USING: there is no old row.`)
  if (check && !policyChecks(draft.command))
    throw new InvalidName(`A policy for ${draft.command} has no WITH CHECK: no row is written.`)
  const roles = draft.roles.length ? list(draft.roles.map(grantee)) : sql.raw('PUBLIC')
  return stmt`CREATE POLICY ${id(name)} ON ${id(draft.schema, draft.table)} AS ${sql.raw(
    draft.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'
  )} FOR ${sql.raw(draft.command)} TO ${roles}${sql.raw(
    (using ? `\n  USING (${using})` : '') + (check ? `\n  WITH CHECK (${check})` : '')
  )}`
}
export const dropPolicyStatement = (schema: string, table: string, name: string) =>
  stmt`DROP POLICY IF EXISTS ${id(name)} ON ${id(schema, table)}`
/** A table's row security: on, off, and whether the owner is held to it as well. */
export const rowSecurityStatement = (schema: string, table: string, enable: boolean) =>
  stmt`ALTER TABLE ${id(schema, table)} ${sql.raw(enable ? 'ENABLE' : 'DISABLE')} ROW LEVEL SECURITY`

/**
 * Whether the owner of the table is held to its row security as well. A table's owner
 * is exempt from it unless it is forced, so a table whose owner reads everything is
 * a table whose policies do not reach its owner.
 */
export const forceRowSecurityStatement = (schema: string, table: string, force = true) =>
  stmt`ALTER TABLE ${id(schema, table)} ${sql.raw(force ? 'FORCE' : 'NO FORCE')} ROW LEVEL SECURITY`
