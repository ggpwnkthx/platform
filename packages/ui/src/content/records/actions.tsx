import type { ColumnInfo, TableInfo } from '@platform/data'
import { href } from '../../url.ts'
import { Action } from '../../ui/button.tsx'
import { PlusIcon, SettingsIcon, TrashIcon } from '../../ui/icons.tsx'

/** What the reader may do with the list: delete what is chosen, or open something else. */
export function RecordsActions({
  info,
  columns,
  table,
  ws,
  chosen,
  canDelete,
  onDelete,
}: {
  info: TableInfo | undefined
  columns: ColumnInfo[]
  table: string
  ws: string
  /** How many records are chosen. */
  chosen: number
  canDelete: boolean
  onDelete: () => void
}) {
  if (!info) return null
  return (
    <>
      {chosen > 0 && canDelete && (
        <Action
          tone="danger"
          label={`Delete ${chosen} selected`}
          icon={<TrashIcon size={20} />}
          onClick={onDelete}
        />
      )}
      {info.can_alter && (
        <Action
          tone="secondary"
          label="Collection settings"
          icon={<SettingsIcon size={20} />}
          href={href('/model/collection', { ws, c: table })}
        />
      )}
      {(info.can_insert || columns.some((c) => c.can_insert)) && (
        <Action
          label="New record"
          icon={<PlusIcon size={22} />}
          href={href('/content/item', { ws, c: table, id: '+' })}
        />
      )}
    </>
  )
}
