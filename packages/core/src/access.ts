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
    SELECT r.*,
      (platform.is_operator()
       OR EXISTS (SELECT 1 FROM platform.visible_memberships() m
                   WHERE m.role = r.name AND m.member = session_user AND m.admin_option)) AS admits
      FROM platform.visible_roles() r`)
  const memberships = await db.query<MembershipInfo>('SELECT * FROM platform.visible_memberships()')
  return { roles: found.rows, memberships: memberships.rows }
}

/** Row policies, and whether each applies to the caller by name, through a group or as PUBLIC. */
export async function policies(db: Db, schema: string, table?: string): Promise<PolicyInfo[]> {
  const result = await db.query<PolicyInfo>(
    `SELECT schemaname::text AS schema, tablename::text AS table, policyname::text AS name,
            permissive, roles::text[] AS roles, cmd AS command, qual AS using, with_check AS check,
            EXISTS (SELECT 1 FROM unnest(roles) r
                     WHERE r = 'public'
                        OR pg_has_role(session_user, to_regrole(quote_ident(r::text))::oid, 'MEMBER')) AS applies
       FROM pg_policies
      WHERE schemaname = $1 AND ($2::text IS NULL OR tablename = $2) ORDER BY 2, 3`,
    [schema, table ?? null]
  )
  return result.rows
}

const granteeName = `CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee)::text END`
/** Every grant in a workspace, from the ACLs themselves: the schema, its tables, their columns. */
export async function grants(db: Db, schema: string): Promise<GrantInfo[]> {
  const result = await db.query<GrantInfo>(
    `SELECT n.nspname::text AS schema, NULL::text AS table, NULL::text AS column, ${granteeName} AS grantee,
            g.privilege_type::text AS privilege, pg_get_userbyid(g.grantor)::text AS grantor,
            g.is_grantable AS grantable
       FROM pg_namespace n, LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) g
      WHERE n.nspname = $1
     UNION ALL
     SELECT n.nspname::text, c.relname::text, NULL::text, ${granteeName},
            g.privilege_type::text, pg_get_userbyid(g.grantor)::text, g.is_grantable
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
            LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
      WHERE n.nspname = $1 AND c.relkind IN ('r','p','v')
     UNION ALL
     SELECT n.nspname::text, c.relname::text, a.attname::text, ${granteeName},
            g.privilege_type::text, pg_get_userbyid(g.grantor)::text, g.is_grantable
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(a.attacl) g
      WHERE n.nspname = $1 AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
      ORDER BY 2 NULLS FIRST, 3 NULLS FIRST, 4, 5`,
    [schema]
  )
  return result.rows
}

/** The roles worth asking about: the ones the caller sees, and the ones the ACLs name. */
const asked = `
  SELECT r.name FROM platform.visible_roles() r WHERE r.name NOT LIKE 'pg\\_%' ESCAPE '\\'
  UNION SELECT pg_get_userbyid(g.grantee)::text
    FROM pg_namespace n, LATERAL aclexplode(n.nspacl) g WHERE n.nspname = $1 AND g.grantee <> 0
  UNION SELECT pg_get_userbyid(g.grantee)::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(c.relacl) g
   WHERE n.nspname = $1 AND g.grantee <> 0
  UNION SELECT pg_get_userbyid(g.grantee)::text
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(a.attacl) g
   WHERE n.nspname = $1 AND a.attnum > 0 AND NOT a.attisdropped AND g.grantee <> 0
  UNION SELECT 'public'`
const who = `(name = 'public' OR to_regrole(quote_ident(name)) IS NOT NULL)`
const hold = (name: string) => `
  CASE WHEN has_table_privilege(w.name::name, c.oid, '${name}') THEN 'all'
       WHEN has_any_column_privilege(w.name::name, c.oid, '${name}') THEN 'some'
       ELSE 'none' END AS ${name.toLowerCase()}`

/**
 * What each role may do in a workspace: PostgreSQL's own answer for that role, so a right
 * held through a group or through PUBLIC counts.
 */
export async function reach(
  db: Db,
  schema: string,
  only: { role?: string; table?: string } = {}
): Promise<ReachInfo[]> {
  const result = await db.query<ReachInfo>(
    `WITH w AS (SELECT name FROM (${asked}) known WHERE ($2::text IS NULL OR name = $2) AND ${who})
     SELECT w.name AS role, c.relname::text AS table,
            has_schema_privilege(w.name::name, n.oid, 'USAGE') AS usage,
            ${['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'].map(hold).join(',')},
            has_table_privilege(w.name::name, c.oid, 'DELETE') AS delete,
            has_table_privilege(w.name::name, c.oid, 'TRUNCATE') AS truncate,
            has_table_privilege(w.name::name, c.oid, 'TRIGGER') AS trigger
       FROM w, pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r','p','v') AND ($3::text IS NULL OR c.relname = $3)
      ORDER BY 2, 1`,
    [schema, only.role ?? null, only.table ?? null]
  )
  return result.rows
}
export async function schemaReach(db: Db, schema: string): Promise<SchemaReachInfo[]> {
  const result = await db.query<SchemaReachInfo>(
    `WITH w AS (SELECT name FROM (${asked}) known WHERE ${who})
     SELECT w.name AS role, has_schema_privilege(w.name::name, n.oid, 'USAGE') AS usage,
            has_schema_privilege(w.name::name, n.oid, 'CREATE') AS create
       FROM w, pg_namespace n WHERE n.nspname = $1 ORDER BY 1`,
    [schema]
  )
  return result.rows
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
