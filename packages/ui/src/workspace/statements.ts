import { grantStatement, schemaStatement } from '@platform/sql'

/**
 * The workspace, written as the statements PostgreSQL runs: the schema itself and the rights
 * on it. They are shown to the reader before they run, and then run as the reader.
 *
 * The statements are the platform's own, written once for the operator's tools and the
 * interface alike.
 */

/** The schema itself, and the role that owns it. */
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
