import type { Hold } from '@platform/data'
import type { Held } from '@platform/vocabulary'
import { drawn, alsoHeld, holdOf, heldOf } from '../model.ts'
import { Mark } from '../rights.tsx'

/** One privilege in a table of marks: the mark, and how many fields a half one covers. */
export function HoldCell({
  hold,
  privilege,
  fields,
  of,
}: {
  hold: Hold
  privilege: string
  /** The fields a privilege held on some of them covers, when the ACL says which. */
  fields?: string[]
  /** How many fields the collection has. */
  of?: number
}) {
  const words =
    hold === 'all' ? 'on the whole collection' : hold === 'some' ? 'on some fields' : 'not held'
  const label = `${privilege}: ${words}${hold === 'some' && fields?.length ? ` (${fields.join(', ')})` : ''}`
  return (
    <td class="matrix-cell">
      <Mark hold={hold} label={label} />
      <span class="sr-only">{words}</span>
      {hold === 'some' && fields && of ? (
        <small class="cell-count" aria-hidden="true">
          {fields.length}/{of}
        </small>
      ) : null}
    </td>
  )
}

/**
 * The cells of a row that says what a grantee holds: one per privilege the table draws, and
 * what is held beyond them.
 */
export function HoldCells({
  held,
  privileges,
  of,
}: {
  /** What the grantee holds, by privilege. */
  held: Record<string, Held>
  /** The privileges this table draws. */
  privileges: readonly string[]
  /** How many fields the collection has. */
  of: number
}) {
  return (
    <>
      {privileges.map((privilege) => (
        <HoldCell
          key={privilege}
          hold={holdOf(held[privilege])}
          privilege={privilege}
          fields={heldOf(held, privilege).columns}
          of={of}
        />
      ))}
      <td class="mono cell-muted">{alsoHeld(held).join(', ')}</td>
    </>
  )
}

/** The heads of the privileges every table of marks carries. */
export const PrivilegeHeads = () => (
  <>
    {drawn.map((privilege) => (
      <th key={privilege} class="matrix-cell mono">
        {privilege}
      </th>
    ))}
  </>
)
