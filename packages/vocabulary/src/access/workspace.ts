import { ident, qualified, schemaStatement } from '../core.ts'
import { grantStatement } from './grants.ts'

/**
 * The workspace, written as the statements PostgreSQL runs: the schema itself and the
 * rights on it. They are shown to the reader before they run, and then run as the reader.
 */
export const workspaceStatements = (name: string, owner: string | null): string[] => [
  schemaStatement(name, owner),
]

/** The rights on the workspace's own schema. */
export const schemaGrantStatement = (
  schema: string,
  privileges: string[],
  grantee: string,
  revoke = false
): string =>
  grantStatement(
    { schema, table: null, privileges, columns: [], grantee, withGrantOption: false },
    revoke
  )

/** The statement that removes a row policy. */
export function dropPolicyStatement(schema: string, table: string, name: string): string {
  return `DROP POLICY ${ident(name)} ON ${qualified(schema, table)};`
}

/** The statement that turns row security on a collection on or off. */
export function rowSecurityStatement(schema: string, table: string, enable: boolean): string {
  return `ALTER TABLE ${qualified(schema, table)} ${enable ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY;`
}
