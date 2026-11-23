import {
  grants as readGrants,
  type GrantInfo,
  type Held,
  type Hold,
  type ReachInfo,
  policies as readPolicies,
  type PolicyInfo,
  reach as readReach,
  roles as readRoles,
  schemaReach,
  type SchemaReachInfo,
  tablePrivileges,
} from '@platform/core'
import { RoleName } from '../bits/marks.tsx'
import { useDb } from '../session/hooks.ts'
/** PostgreSQL folds role names; two names that differ only in case are one role. */
export const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** The roles and memberships the caller may see. */
export const useRoles = () => useDb(['roles'], readRoles)
/** Every grant in a workspace, from the ACLs themselves. */
export const useGrants = (schema: string) =>
  useDb(['grants', schema], (db) => readGrants(db, schema), !!schema)
/** Who may use a workspace, and who may make collections in it. */
export const useSchemaReach = (schema: string) =>
  useDb(['schemaReach', schema], (db) => schemaReach(db, schema), !!schema)
/** What each role may do in a workspace, as PostgreSQL itself answers. */
export const useReach = (schema: string, only: { role?: string; table?: string } = {}) =>
  useDb(['reach', schema, only.role ?? null, only.table ?? null], (db) =>
    readReach(db, schema, only)
  )
/** The row policies of a workspace's collections, or of one. */
export const usePolicies = (schema: string, table?: string) =>
  useDb(['policies', schema, table ?? null], (db) => readPolicies(db, schema, table), !!schema)

/** A role, with what the reader may know of it: a group is drawn as one. */
export function Role({ name, link }: { name: string; link?: string }) {
  const known = useRoles().data?.roles.find((r) => r.name === name)
  return <RoleName name={name} group={known ? !known.login : undefined} link={link} />
}
export const reachOf = (row: ReachInfo, privilege: string) =>
  row[privilege.toLowerCase() as 'select'] as Hold | boolean
export const holdsAny = (row: ReachInfo) =>
  tablePrivileges.some((p) => ![false, 'none'].includes(reachOf(row, p)))

/** What a role holds by name on a collection, as its ACL and its fields' ACLs record it. */
export function heldBy(grants: GrantInfo[], table: string, role: string): Record<string, Held> {
  const held: Record<string, Held> = {}
  for (const g of grants) {
    if (g.table !== table || !same(g.grantee, role)) continue
    held[g.privilege] ??= { whole: false, columns: [] }
    const one = held[g.privilege]!
    if (g.column) one.columns.push(g.column)
    else one.whole = true
  }
  return held
}
export type { PolicyInfo, ReachInfo, SchemaReachInfo }
