import type { Db } from '../pg/connect.ts'
import type { SchemaGrantInfo } from './types.ts'

/** The rights on the workspace's own schema: who may use it, and who may add to it. */
export async function schemaGrants(db: Db, schema: string): Promise<SchemaGrantInfo[]> {
  const result = await db.query<SchemaGrantInfo>(
    `
    SELECT n.nspname::text AS schema,
           CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee)::text END AS grantee,
           g.privilege_type::text AS privilege, g.is_grantable AS grantable
      FROM pg_namespace n, LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) g
     WHERE n.nspname = $1 ORDER BY 2, 3`,
    [schema]
  )
  return result.rows
}
