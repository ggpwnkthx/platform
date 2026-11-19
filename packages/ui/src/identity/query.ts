import type { Db } from '../pg/connect.ts'
import type { Identity } from './types.ts'

/** Who the reader is, as PostgreSQL sees them on their own login. */
export async function identity(db: Db): Promise<Identity> {
  const result = await db.query<Identity>(`
    SELECT session_user::text AS username, current_user::text AS effective_role,
           current_database()::text AS database,
           (SELECT version FROM platform.installation) AS platform_version,
           current_setting('server_version') AS server_version,
           has_database_privilege(current_database(), 'CREATE') AS can_create_workspace,
           platform.is_operator() AS is_operator`)
  return result.rows[0]!
}
