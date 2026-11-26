import { IconButton } from '@mui/material'
import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useGetList } from 'react-admin'
import type { Kind } from '../data/kinds.ts'
import { Tip } from '../kit/Header.tsx'
import { KindChange, type Open } from '../kit/Kinds.tsx'
import { iconSize } from '../kit/marks.tsx'
import { useSession } from '../session/session.ts'

/**
 * The page's own thing, changed or deleted from its header: a schema on its page, a
 * table on its model. Offered where PostgreSQL says the reader owns it; a rename and a
 * drop say where the reader goes next, since the address named what is no longer there.
 */
export function ItemActions(props: {
  kind: Kind
  where: object
  name: string
  noun: string
  onRan(form: Record<string, unknown>, action: 'update' | 'remove'): void
}) {
  const { kind, where, name } = props
  const [open, setOpen] = useState<Open>(null)
  const { db: _db, ...ctx } = useSession()
  const found = useGetList(kind.name, { filter: where, pagination: { page: 1, perPage: 1000 } })
  const row = found.data?.find((r) => r.id === name)
  if (!row || !(kind.mayRow?.(row, where, ctx) ?? true)) return null
  return (
    <>
      <Tip title={`Alter ${props.noun}`}>
        <IconButton
          aria-label={`Alter ${props.noun}`}
          onClick={() => setOpen({ action: 'update', row })}
        >
          <Pencil size={iconSize} />
        </IconButton>
      </Tip>
      <Tip title={`Drop ${props.noun}`}>
        <IconButton
          aria-label={`Drop ${props.noun}`}
          color="error"
          onClick={() => setOpen({ action: 'remove', row })}
        >
          <Trash2 size={iconSize} />
        </IconButton>
      </Tip>
      {open && (
        <KindChange
          kind={kind}
          where={where}
          open={open}
          onClose={() => setOpen(null)}
          onRan={(form) => props.onRan(form, open.action as 'update' | 'remove')}
        />
      )}
    </>
  )
}
