import { Alert, Button, IconButton } from '@mui/material'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { DataTable, ListBase } from 'react-admin'
import type { Kind } from '../data/kinds.ts'
import { useSession } from '../session/session.ts'
import { Change } from './Change.tsx'
import { iconSize } from './marks.tsx'
import { HeaderActions, Tip } from './Header.tsx'
import { Section } from './said.tsx'
import { Table } from './Table.tsx'

export type Open = { action: 'create' | 'update' | 'remove'; row?: Record<string, unknown> } | null
/**
 * The rows of a kind, in the one table, with its changes offered where PostgreSQL would
 * accept them: add at the heading's right, change and remove on each row, each through the
 * change surface. It is a section of its page, under the kind's own heading unless the page
 * says another. The kind a page leads with adds from the header, as the page's primary action.
 */
export function KindTable(props: {
  kind: Kind
  where: object
  add?: string
  title?: string
  lead?: boolean
}) {
  const { kind, where } = props
  const { db: _db, ...ctx } = useSession()
  const [open, setOpen] = useState<Open>(null)
  const may = kind.may?.(where, ctx) ?? true
  const mayRow = (row: object) => kind.mayRow?.(row, where, ctx) ?? may
  const acts = (may || kind.mayRow) && (kind.update || kind.remove)
  const label = props.add ?? addLabel(kind)
  const add = may && kind.create && (
    <Button
      variant={props.lead ? 'contained' : 'outlined'}
      startIcon={<Plus size={iconSize} />}
      aria-label={label}
      onClick={() => setOpen({ action: 'create' })}
      sx={{ flex: 'none', alignSelf: props.lead ? 'center' : 'flex-end' }}
    >
      {label}
    </Button>
  )
  const act = (action: 'update' | 'remove', row: Record<string, unknown>) => (
    <IconButton
      size="small"
      color={action === 'remove' ? 'error' : 'default'}
      aria-label={`${verbsOf(kind)[action]} ${row.id}`}
      title={verbsOf(kind)[action]}
      onClick={() => setOpen({ action, row })}
    >
      {action === 'remove' ? <Trash2 size={iconSize} /> : <Pencil size={iconSize} />}
    </IconButton>
  )
  const table = (
    <Table
      empty={kind.empty}
      // A section's own add is beside its heading; a page's is in the header, far from here.
      then={
        props.lead &&
        may &&
        kind.create && (
          <Button
            variant="outlined"
            startIcon={<Plus size={iconSize} />}
            onClick={() => setOpen({ action: 'create' })}
          >
            {label}
          </Button>
        )
      }
      bulkActionButtons={false}
      rowClick={false}
      data-kind={kind.name}
    >
      {kind.columns.map((column, at) => (
        <DataTable.Col
          key={column.source}
          source={column.source}
          label={column.label}
          cellClassName={at === 0 ? 'pinned' : column.wide ? 'wide' : undefined}
          headerClassName={at === 0 ? 'pinned' : undefined}
          render={column.render ? (row) => column.render!(row, ctx) : undefined}
        />
      ))}
      {acts && (
        <DataTable.Col
          source="id"
          label=""
          disableSort
          align="right"
          cellClassName="wide acts"
          render={(row) =>
            mayRow(row) && (
              <>
                {kind.update && act('update', row)}
                {kind.remove && act('remove', row)}
              </>
            )
          }
        />
      )}
    </Table>
  )
  return (
    <ListBase
      resource={kind.name}
      filter={where}
      perPage={1000}
      disableSyncWithLocation
      storeKey={false}
      disableAuthentication
    >
      <Section
        title={props.title ?? kind.title}
        note={props.title ? undefined : kind.note}
        action={props.lead ? undefined : add}
      >
        {table}
      </Section>
      {props.lead && add && (
        <HeaderActions>
          <Tip title={label} labelled>
            {add}
          </Tip>
        </HeaderActions>
      )}
      {open && <KindChange kind={kind} where={where} open={open} onClose={() => setOpen(null)} />}
    </ListBase>
  )
}

/** The verbs of a kind's changes: PostgreSQL's CREATE, ALTER and DROP unless it says others. */
export const verbsOf = (kind: Kind) => ({
  create: 'Create',
  update: 'Alter',
  remove: 'Drop',
  ...kind.verbs,
})
const addLabel = (kind: Kind) => `${verbsOf(kind).create} ${kind.noun}`

/** One change to one kind: its form, and the statements the kind says the change is. */
export function KindChange({
  kind,
  where,
  open,
  onClose,
  onRan,
}: {
  kind: Kind
  where: object
  open: NonNullable<Open>
  onClose(): void
  onRan?(form: Record<string, unknown>): void
}) {
  const { db: _db, ...ctx } = useSession()
  const { action, row } = open
  const title = {
    create: addLabel(kind),
    update: `${verbsOf(kind).update} ${kind.noun} ${row?.id ?? ''}`,
    remove: `${verbsOf(kind).remove} ${kind.noun} ${row?.id ?? ''}`,
  }[action]
  return (
    <Change
      title={title}
      onClose={onClose}
      onRan={onRan}
      danger={action === 'remove'}
      label={action === 'remove' ? verbsOf(kind).remove : undefined}
      atomic={kind.atomic}
      defaults={action === 'remove' ? {} : kind.defaults?.(where, row, ctx)}
      statements={(form) =>
        action === 'create'
          ? kind.create!(form, where, ctx)
          : action === 'update'
            ? kind.update!(form, where, row, ctx)
            : kind.remove!(row, where, ctx)
      }
    >
      {action !== 'remove' && kind.Inputs && <kind.Inputs where={where} row={row} />}
      {action === 'remove' && kind.loses && (
        <Alert severity="warning" data-loses>
          {kind.loses(row)}
        </Alert>
      )}
    </Change>
  )
}
