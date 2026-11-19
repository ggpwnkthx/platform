import type { DataSource } from '@platform/vocabulary'
import type { GrantInfo, MembershipInfo, PolicyInfo, RoleInfo } from './types.ts'

/**
 * The access the reader may see: the roles, the groups they belong to, the grants on the
 * tables and the row policies of the workspace. It is PostgreSQL's own answer, through the
 * platform's own functions and the catalog's ACLs.
 */

/** The roles and memberships the reader may see, through the platform's own functions. */
export async function roles(
  db: DataSource
): Promise<{ roles: RoleInfo[]; memberships: MembershipInfo[] }> {
  const found = await db.query<RoleInfo>(`
    SELECT r.*,
      (platform.is_operator()
       OR EXISTS (SELECT 1 FROM platform.visible_memberships() m
                   WHERE m.role = r.name AND m.member = session_user AND m.admin_option)
       OR (coalesce((SELECT create_role FROM platform.role_attributes(session_user)), false)
           AND NOT r.superuser)) AS admits
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
