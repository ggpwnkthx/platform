/**
 * A transaction, written once.
 *
 * The operator's tools run their statements on a `pg.Client`; the interface runs them on a
 * connection it opened in the page. Both want the same thing: the statements happen, or
 * none of them do. The wrapper takes anything that can run a statement, so both use it.
 */

/** Anything that can run a statement: a PostgreSQL client, or the interface's own. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<unknown>
}

/** Runs statements as one transaction: all of them happen, or none. */
export async function transaction<T>(q: Queryable, fn: () => Promise<T>): Promise<T> {
  await q.query('BEGIN')
  try {
    const result = await fn()
    await q.query('COMMIT')
    return result
  } catch (error) {
    await q.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}
