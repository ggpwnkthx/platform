import type { Db } from './db.ts'

export interface RoleInfo {
  name: string
  login: boolean
  inherit: boolean
  create_role: boolean
  bypass_rls: boolean
  superuser: boolean
  admits: boolean
}
export interface MembershipInfo {
  role: string
  member: string
  admin_option: boolean
  inherit_option: boolean
  set_option: boolean
}
export interface PolicyInfo {
  schema: string
  table: string
  name: string
  permissive: string
  roles: string[]
  command: string
  using: string | null
  check: string | null
  applies: boolean
}
export interface GrantInfo {
  schema: string
  table: string | null
  column: string | null
  grantee: string
  privilege: string
  grantor: string
  grantable: boolean
}
export type Hold = 'all' | 'some' | 'none'
export interface ReachInfo {
  role: string
  table: string
  usage: boolean
  select: Hold
  insert: Hold
  update: Hold
  references: Hold
  delete: boolean
  truncate: boolean
  trigger: boolean
}
export interface SchemaReachInfo {
  role: string
  usage: boolean
  create: boolean
}
export interface ActivityInfo {
  id: number
  at: string
  transaction_id: number
  actor: string
  schema_name: string
  table_name: string
  operation: string
  before_row: Record<string, unknown> | null
  after_row: Record<string, unknown> | null
}

/** The roles and memberships the caller may see: the platform's functions answer for them. */
export async function roles(db: Db) {
  const found = await db.query<RoleInfo>(`
    SELECT r.*, pg_has_role(r.name::name, 'MEMBER WITH ADMIN OPTION') AS admits
      FROM platform.visible_roles() r`)
  const memberships = await db.query<MembershipInfo>('SELECT * FROM platform.visible_memberships()')
  return { roles: found.rows, memberships: memberships.rows }
}

/** Row policies, and whether each applies to the caller by name, through a group or as PUBLIC. */
export async function policies(db: Db, schema: string, table?: string): Promise<PolicyInfo[]> {
  const result = await db.query<PolicyInfo>(
    `SELECT * FROM platform.access_policies
      WHERE schema = $1 AND ($2::text IS NULL OR "table" = $2) ORDER BY 2, 3`,
    [schema, table ?? null]
  )
  return result.rows
}

/** Every grant in a workspace, from the ACLs themselves: the schema, its tables, their columns. */
export async function grants(db: Db, schema: string): Promise<GrantInfo[]> {
  const result = await db.query<GrantInfo>(
    `SELECT * FROM platform.access_grants WHERE schema = $1
      ORDER BY "table" NULLS FIRST, "column" NULLS FIRST, grantee, privilege`,
    [schema]
  )
  return result.rows
}

/**
 * What each role may do in a workspace: PostgreSQL's own answer for that role, so a right
 * held through a group or through PUBLIC counts.
 */
export async function reach(
  db: Db,
  schema: string,
  only: { role?: string; table?: string } = {}
): Promise<ReachInfo[]> {
  const result = await db.query<ReachInfo>('SELECT * FROM platform.reach($1, $2, $3)', [
    schema,
    only.role ?? null,
    only.table ?? null,
  ])
  return result.rows
}
export async function schemaReach(db: Db, schema: string): Promise<SchemaReachInfo[]> {
  return (await db.query<SchemaReachInfo>('SELECT * FROM platform.schema_reach($1)', [schema])).rows
}

/** The revisions the caller may read, newest first: rows cut to the columns they may read. */
export async function activity(
  db: Db,
  query: { schema: string; table?: string; row?: string; before?: number; limit?: number }
): Promise<ActivityInfo[]> {
  const result = await db.query<ActivityInfo>(
    `SELECT id::int AS id, at::text AS at, transaction_id::text AS transaction_id, actor,
            schema_name, table_name, operation, before_row, after_row
       FROM platform.revisions
      WHERE schema_name = $1 AND ($2::text IS NULL OR table_name = $2)
        AND ($3::text IS NULL OR after_row->>'id' = $3 OR before_row->>'id' = $3)
        AND ($4::bigint IS NULL OR id < $4)
      ORDER BY id DESC LIMIT $5`,
    [
      query.schema,
      query.table ?? null,
      query.row ?? null,
      query.before ?? null,
      Math.min(query.limit ?? 100, 500),
    ]
  )
  return result.rows
}
