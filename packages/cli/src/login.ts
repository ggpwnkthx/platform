import type pg from 'pg'
import { ident } from '@platform/vocabulary'

/**
 * Whether a role may log in at all. NOLOGIN is what a token cannot get past: it stops the
 * next login at once, wherever the token came from and however long it has left. It is how a
 * person is locked out, and how the administrator is kept shut between the times it is used.
 * A session that is already open is not a login, so locking ends those as well.
 */
export async function setLogin(
  q: pg.Client,
  command: 'lock' | 'unlock',
  name: string | undefined
): Promise<string[]> {
  if (!name) throw new Error(`${command} needs a role: the address the person signs in with`)
  const found = await q.query(
    `SELECT a.login, $1 = session_user AS self, to_regrole(quote_ident($1))::oid = 10 AS server
       FROM platform.role_attributes($1) a`,
    [name]
  )
  const role = found.rows[0] as { login: boolean; self: boolean; server: boolean } | undefined
  if (!role) throw new Error(`There is no role ${name} here, or it is not yours to administer`)
  if (role.self) throw new Error(`${name} is the role this command is signed in as`)
  // The server's own superuser has no login over the network as it is; without a login it
  // has none through the socket either, and that is the way in when nothing else is.
  if (role.server) throw new Error(`${name} is the server's own superuser, and is left alone`)
  await q.query(`ALTER ROLE ${ident(name)} ${command === 'lock' ? 'NOLOGIN' : 'LOGIN'}`)
  if (command === 'unlock')
    return [
      role.login ? `${name} could already log in.` : `${name} may log in again, with a token.`,
    ]
  const said = [
    role.login
      ? `${name} can no longer log in, whatever token names it.`
      : `${name} already had no login.`,
  ]
  try {
    const ended = await q.query(
      // Chosen first, and then ended: no other role's session is ever asked to close.
      `WITH held AS MATERIALIZED (
         SELECT pid FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid())
       SELECT count(*) FILTER (WHERE pg_terminate_backend(pid))::int AS n FROM held`,
      [name]
    )
    if (ended.rows[0].n) said.push(`Ended ${ended.rows[0].n} of its open sessions.`)
  } catch (error) {
    if ((error as { code?: string }).code !== '42501') throw error
    said.push(
      'Its open sessions are not this role’s to end: they last until they close. A superuser can end them with pg_terminate_backend.'
    )
  }
  return said
}
