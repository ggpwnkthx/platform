import type { DataSource } from '@platform/vocabulary'
import type {
  GrantInfo,
  MembershipInfo,
  PolicyInfo,
  ReachInfo,
  RoleInfo,
  SchemaReachInfo,
} from './types.ts'

/**
 * The access the reader may see: the roles, the groups they belong to, the grants on the
 * tables and the row policies of the workspace. It is PostgreSQL's own answer, through the
 * platform's own functions and the catalog's ACLs.
 */

/**
 * The roles and memberships the reader may see, through the platform's own functions.
 *
 * A role admits members to a group it holds with the admin option, and an operator to any.
 * The right to create roles is not that right: since PostgreSQL 16 it admits nobody to a
 * role it does not hold with the admin option, and holds that way the roles it created.
 */
export async function roles(
  db: DataSource
): Promise<{ roles: RoleInfo[]; memberships: MembershipInfo[] }> {
  const found = await db.query<RoleInfo>(`
    SELECT r.*,
      (platform.is_operator()
       OR EXISTS (SELECT 1 FROM platform.visible_memberships() m
                   WHERE m.role = r.name AND m.member = session_user AND m.admin_option)) AS admits
      FROM platform.visible_roles() r`)
  const memberships = await db.query<MembershipInfo>('SELECT * FROM platform.visible_memberships()')
  return { roles: found.rows, memberships: memberships.rows }
}

export async function policies(db: DataSource): Promise<PolicyInfo[]> {
  const result = await db.query<PolicyInfo>(`
    SELECT schemaname::text AS schema, tablename::text AS table, policyname::text AS name,
           permissive, roles::text[] AS roles, cmd AS command, qual AS using, with_check AS check
      FROM pg_policies
     WHERE schemaname NOT IN ('platform')
     ORDER BY 1, 2, 3`)
  return result.rows
}

/** The grants on the tables and columns of one workspace, read from their ACLs. */
export async function grants(db: DataSource, schema: string): Promise<GrantInfo[]> {
  const result = await db.query<GrantInfo>(
    `
    SELECT n.nspname::text AS schema, c.relname::text AS table, NULL::text AS column,
           CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee)::text END AS grantee,
           g.privilege_type::text AS privilege, pg_get_userbyid(g.grantor)::text AS grantor,
           g.is_grantable AS grantable
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
           LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
     WHERE n.nspname = $1 AND c.relkind IN ('r','p','v')
    UNION ALL
    SELECT n.nspname::text, c.relname::text, a.attname::text,
           CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee)::text END,
           g.privilege_type::text, pg_get_userbyid(g.grantor)::text, g.is_grantable
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace,
           LATERAL aclexplode(a.attacl) g
     WHERE n.nspname = $1 AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
     ORDER BY 2, 3 NULLS FIRST, 4, 5`,
    [schema]
  )
  return result.rows
}

/**
 * The roles a question about a workspace is asked of: the ones the reader may see, the ones
 * the workspace's own ACLs name, and PUBLIC. A role an ACL names is named there for every
 * connected user to read, so asking about it tells the reader nothing the catalog did not.
 */
/**
 * Whether a name is a role's. An ACL may name a role that has since been dropped, by a
 * number, and the privilege functions refuse a name that is nobody's. PostgreSQL is asked
 * for the role rather than pg_roles for a row: the catalog may be hidden from the reader
 * (`cli harden`), and the answer is the same.
 */
const isRole = `to_regrole(quote_ident(name)) IS NOT NULL`

const asked = `
  SELECT r.name FROM platform.visible_roles() r WHERE r.name NOT LIKE 'pg\\_%' ESCAPE '\\'
  UNION
  SELECT pg_get_userbyid(g.grantee)::text
    FROM pg_namespace n, LATERAL aclexplode(n.nspacl) g
   WHERE n.nspname = $1 AND g.grantee <> 0
  UNION
  SELECT pg_get_userbyid(g.grantee)::text
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(c.relacl) g
   WHERE n.nspname = $1 AND g.grantee <> 0
  UNION
  SELECT pg_get_userbyid(g.grantee)::text
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(a.attacl) g
   WHERE n.nspname = $1 AND a.attnum > 0 AND NOT a.attisdropped AND g.grantee <> 0
  UNION
  SELECT 'public'`

/** One privilege, held on the whole collection, on some of its fields, or not at all. */
const hold = (name: string) => `
  CASE WHEN has_table_privilege(w.name::name, c.oid, '${name}') THEN 'all'
       WHEN has_any_column_privilege(w.name::name, c.oid, '${name}') THEN 'some'
       ELSE 'none' END`

/**
 * What roles may do with the collections of one workspace: PostgreSQL's own answer for each
 * role, so a right held through a group or through PUBLIC counts as the role's. Asked of one
 * role, of one collection, or of both; PUBLIC is written `public`.
 */
export async function reach(
  db: DataSource,
  schema: string,
  only: { role?: string; table?: string } = {}
): Promise<ReachInfo[]> {
  // fallow-ignore-next-line security-sink -- every name is the platform's own constant; every value is bound
  const result = await db.query<ReachInfo>(
    `
    WITH w AS (SELECT name FROM (${asked}) known
                WHERE ($2::text IS NULL OR name = $2)
                  AND (name = 'public' OR ${isRole}))
    SELECT w.name AS role, c.relname::text AS table,
           has_schema_privilege(w.name::name, n.oid, 'USAGE') AS usage,
           ${hold('SELECT')} AS select, ${hold('INSERT')} AS insert,
           ${hold('UPDATE')} AS update, ${hold('REFERENCES')} AS references,
           has_table_privilege(w.name::name, c.oid, 'DELETE') AS delete,
           has_table_privilege(w.name::name, c.oid, 'TRUNCATE') AS truncate,
           has_table_privilege(w.name::name, c.oid, 'TRIGGER') AS trigger
      FROM w, pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind IN ('r','p','v')
       AND ($3::text IS NULL OR c.relname = $3)
     ORDER BY 2, 1`,
    [schema, only.role ?? null, only.table ?? null]
  )
  return result.rows
}

/** What roles may do with the workspace's own schema: PostgreSQL's own answer for each. */
export async function schemaReach(db: DataSource, schema: string): Promise<SchemaReachInfo[]> {
  const result = await db.query<SchemaReachInfo>(
    `
    WITH w AS (SELECT name FROM (${asked}) known
                WHERE name = 'public' OR ${isRole})
    SELECT w.name AS role,
           has_schema_privilege(w.name::name, n.oid, 'USAGE') AS usage,
           has_schema_privilege(w.name::name, n.oid, 'CREATE') AS create
      FROM w, pg_namespace n
     WHERE n.nspname = $1
     ORDER BY 1`,
    [schema]
  )
  return result.rows
}
