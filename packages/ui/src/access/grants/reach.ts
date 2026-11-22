import { type GrantInfo, type MembershipInfo, reach as readReach } from '@platform/data'
import { useLoad } from '../../session.tsx'
import { asked, heldBy, holdOf, throughOf } from '../model.ts'

/**
 * What the database says the role reaches: on this collection, and through the groups it is
 * in. A group that holds a privilege gives it to every member of it.
 */
export function useReach({
  open,
  schema,
  table,
  grantee,
  grants,
  memberships,
}: {
  open: boolean
  schema: string
  table: string
  grantee: string
  grants: GrantInfo[]
  memberships: MembershipInfo[]
}) {
  const answer = useLoad(
    open && grantee && table
      ? (db) => readReach(db, schema, { role: asked(grantee), table })
      : null,
    [open, schema, table, grantee, grants]
  )
  const reach = answer.data?.find((row) => row.role === asked(grantee) && row.table === table)
  const through = throughOf(grantee, table, grants, memberships)
  // Of the roles it inherits from, the ones the ACL gives this privilege to.
  const givers = (privilege: string) =>
    through.filter((giver) => holdOf(heldBy(grants, table, giver)[privilege]) !== 'none')
  return { reach, givers }
}
