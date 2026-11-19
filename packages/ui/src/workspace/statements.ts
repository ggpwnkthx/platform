import { ident, InvalidName, role } from '@platform/sql'

/**
 * The workspace, written as the statements PostgreSQL runs: the schema itself and the rights
 * on it. They are shown to the reader before they run, and then run as the reader.
 */

export function workspaceStatements(name: string, owner: string | null): string[] {
  return [`CREATE SCHEMA ${ident(name)}${owner ? ` AUTHORIZATION ${role(owner)}` : ''};`]
}

export const schemaPrivileges = ['USAGE', 'CREATE'] as const

export function schemaGrantStatement(
  schema: string,
  privileges: string[],
  grantee: string,
  revoke = false
): string {
  if (!privileges.length) throw new InvalidName('Choose at least one privilege')
  if (!grantee) throw new InvalidName('Choose who receives it')
  const who = grantee === 'PUBLIC' ? 'PUBLIC' : role(grantee)
  return revoke
    ? `REVOKE ${privileges.join(', ')} ON SCHEMA ${ident(schema)} FROM ${who};`
    : `GRANT ${privileges.join(', ')} ON SCHEMA ${ident(schema)} TO ${who};`
}
