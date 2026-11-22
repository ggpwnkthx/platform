import {
  type Held,
  type Wanted,
  grantChangeStatements,
  schemaGrantStatement,
} from '@platform/vocabulary'
import { changeOf } from './change.ts'

/**
 * The statements that change what the role holds, and the problem the database would have
 * with them: a statement that cannot be made is caught here, before the reader is asked to
 * run it.
 */
export function changeStatements({
  schema,
  table,
  grantee,
  held,
  edits,
  option,
  isOwner,
}: {
  schema: string
  table: string
  grantee: string
  held: Record<string, Held>
  edits: Record<string, Wanted>
  option: boolean
  isOwner: boolean
}) {
  return changeOf(() =>
    grantee && table && !isOwner
      ? grantChangeStatements({
          schema,
          table,
          grantee,
          held,
          wanted: edits,
          withGrantOption: option,
        })
      : []
  )
}

/**
 * The statements that change what the role holds. The usage on the workspace is granted with
 * them, when the reader asks for it: a grant on a collection is of no use to a role that may
 * not use the workspace it is in.
 */
export function grantStatements({
  change,
  grantee,
  lacksUsage,
  mayGrantUsage,
  schema,
  withUsage,
}: {
  change: { statements: string[]; problem: string | null }
  grantee: string
  lacksUsage: boolean
  mayGrantUsage: boolean
  schema: string
  withUsage: boolean
}): string[] {
  if (!(lacksUsage && mayGrantUsage && withUsage && (change.statements.length || !change.problem)))
    return change.statements
  return [schemaGrantStatement(schema, ['USAGE'], grantee), ...change.statements]
}
