/**
 * A source of statements: anything that can run one and answer with rows.
 *
 * The interface runs its statements on a connection it opened in the page; the operator's
 * tools run theirs on a client in Node; a script may run them on either. None of them is
 * the vocabulary: a source says nothing about what a statement means. It runs the statement
 * and hands back what PostgreSQL answered, so that the same question may be asked of any of
 * them and mean the same thing.
 *
 * This module has no dependencies and runs in the browser, in Bun and in Node.
 */

/** What a statement leaves behind: the rows it returned, and what it changed. */
export interface RowSet<Row = Record<string, unknown>> {
  /** The rows the statement returned. */
  rows: Row[]
  /** The rows the statement changed, when it changed any. */
  affected?: number | null
}

/**
 * Anything that can run a statement: the interface's own connection, a client in Node, a
 * test's stub. The rows are typed by the caller, because only the caller knows what it
 * asked for.
 */
export interface DataSource {
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<RowSet<Row>>
}
