import type { ComponentChildren } from 'preact'

/**
 * A table of what the database holds: the heads of its columns, and the rows below them.
 *
 * The heads are given as words rather than as markup, so that a row and the columns above it
 * are written in one place and cannot drift apart.
 */
export function Grid({
  head,
  children,
}: {
  /** The heads of the columns, in the order the rows below hold them. */
  head: readonly string[]
  /** The rows of the table. */
  children: ComponentChildren
}) {
  return (
    <div class="grid-wrap">
      <table class="grid">
        <thead>
          <tr>
            {head.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
