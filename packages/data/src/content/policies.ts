import type { DataSource } from '@platform/vocabulary'
import type { PolicyInfo } from '../access/types.ts'

export async function tablePolicies(db: DataSource, schema: string, table: string) {
  const result = await db.query<PolicyInfo & { applies: boolean }>(
    `SELECT schemaname::text AS schema, tablename::text AS table, policyname::text AS name, permissive,
            roles::text[] AS roles, cmd AS command, qual AS using, with_check AS check,
            EXISTS (SELECT 1 FROM unnest(roles) r
                     WHERE r = 'public'
                        OR pg_has_role(session_user, to_regrole(quote_ident(r::text))::oid, 'MEMBER')) AS applies
       FROM pg_policies WHERE schemaname = $1 AND tablename = $2 ORDER BY policyname`,
    [schema, table]
  )
  return result.rows
}
