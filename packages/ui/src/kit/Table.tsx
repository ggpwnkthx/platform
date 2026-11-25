import { Box, LinearProgress } from '@mui/material'
import type { ReactNode } from 'react'
import { DataTable, type DataTableProps, useListContext } from 'react-admin'
import tokens from 'virtual:design-tokens'
import { Empty, Refusal } from './said.tsx'

const { layout, rounded, colors } = tokens
/**
 * The one table. Records and every kind of thing are listed by it: a bordered card, a pinned
 * first column, values clipped at one width with the whole value in their title, and one
 * way each of saying loading, empty and refused.
 */
export function Table({
  empty,
  then,
  children,
  ...props
}: DataTableProps & {
  empty: string
  /** What fills an empty table: offered under the empty words, unless a search emptied it. */
  then?: ReactNode
  children: ReactNode
}) {
  const { error, isPending, isFetching, filterValues } = useListContext()
  // An empty page says what emptied it: the search and conditions, where there are any.
  const narrowed = Object.keys(filterValues ?? {}).length > 0
  const said = empty.endsWith('.')
    ? empty
    : `${empty}${narrowed ? ' matches the search and its conditions' : ''}.`
  if (error) return <Refusal error={error} />
  return (
    <Box
      sx={{
        position: 'relative',
        border: 1,
        borderColor: 'divider',
        borderRadius: rounded.md,
        overflow: 'auto',
        '& td:not(.wide), & th': {
          maxWidth: layout.cell,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
        '& td.wide': { whiteSpace: 'nowrap' },
        '& tbody tr:last-of-type td': { borderBottom: 0 },
        '& .pinned': { position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper' },
        // What may be done to a row stays in reach however wide the row is.
        '& .acts': { position: 'sticky', right: 0, bgcolor: 'background.paper' },
        '& th.pinned': { bgcolor: 'grey.100' },
        '& [data-null]': { color: colors['faint-text'] },
      }}
    >
      {isFetching && (
        <LinearProgress data-loading sx={{ position: 'absolute', insetInline: 0, top: 0 }} />
      )}
      {!isPending && (
        <DataTable
          hover
          empty={
            <Box sx={{ px: 4, pb: then && !narrowed ? 4 : 0 }}>
              <Empty>{said}</Empty>
              {!narrowed && then}
            </Box>
          }
          {...props}
        >
          {children}
        </DataTable>
      )}
    </Box>
  )
}
