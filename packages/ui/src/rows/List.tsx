import { Box, Button } from '@mui/material'
import { ExportCsv, ImportCsv } from './Transfer.tsx'
import { valueless } from '@platform/core'
import { Plus, Settings2 } from 'lucide-react'
import { useEffect } from 'react'
import {
  BulkDeleteButton,
  DataTable,
  FilterButton,
  FilterContext,
  List,
  SearchInput,
  SelectInput,
  useCreatePath,
  useListContext,
} from 'react-admin'
import { useFormContext, useWatch } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { Value } from '../columns/renderers.tsx'
import type { Column } from '../columns/types.ts'
import { ItemMark, iconSize } from '../kit/marks.tsx'
import { Tip } from '../kit/Header.tsx'
import { PageTitle } from '../kit/Page.tsx'
import { Table } from '../kit/Table.tsx'
import { TableAside } from './Aside.tsx'
import { operatorWords, useTable } from './table.ts'

/** One condition of the filter: a column, the operator it is held to, and the value it is given. */
function Condition({
  column,
  source,
}: {
  column: Column
  source: string
  label: string
  defaultValue: object
}) {
  const op = useWatch({ name: `${source}.op` })
  const value = useWatch({ name: `${source}.value` })
  const { setValue } = useFormContext()
  const many =
    ['in', 'not_in', 'has_any', 'has_none', 'has_all'].includes(op) && column.type.name !== 'text'
  // A condition on several rows holds a list; any other holds one value.
  useEffect(() => {
    if (many !== Array.isArray(value)) setValue(`${source}.value`, many ? [] : '')
  }, [many, value, setValue, source])
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }} data-condition={source}>
      <SelectInput
        source={`${source}.op`}
        label={column.label}
        helperText={false}
        choices={column.type.operators.map((id) => ({ id, name: operatorWords[id] }))}
        validate={(chosen) => (chosen ? undefined : 'Required')}
      />
      {!valueless.includes(op) && many === Array.isArray(value) && (
        <column.type.Input column={column} source={`${source}.value`} label="Value" op={op} />
      )}
    </Box>
  )
}

/** The rows chosen are deleted under the versions this page shows, in one transaction. */
function DeleteChosen() {
  const { data = [], selectedIds } = useListContext()
  const versions = Object.fromEntries(
    data.filter((row) => selectedIds.includes(row.id)).map((row) => [row.id, row.version])
  )
  return <BulkDeleteButton mutationMode="pessimistic" mutationOptions={{ meta: { versions } }} />
}

/** The rows of a table: search, filters, sort, pages and a count — all kept in the address. */
export function RowList() {
  const { resource, schema, table, columns, info, said, schemaSaid, hasId } = useTable()
  const createPath = useCreatePath()
  if (!info) return <PageTitle title={table} crumb="No such table that you may reach" />
  const shown = columns.filter((f) => f.column?.can_select && f.views.list !== 'hide')
  const filters = [
    <SearchInput key="q" source="q" alwaysOn placeholder="Search the columns you may read" />,
    ...columns
      .filter((f) => f.views.filter !== 'hide' && (f.virtual || f.column?.can_select))
      .map((f) => (
        <Condition
          key={f.name}
          column={f}
          source={f.name}
          label={f.label}
          defaultValue={{ op: f.type.operators[0], value: '' }}
        />
      )),
  ]
  const writes = (info.kind === 'r' || info.kind === 'p') && hasId
  return (
    <List
      resource={resource}
      title={
        <PageTitle
          title={said.name}
          crumb={schemaSaid.name}
          mark={<ItemMark {...said} table />}
          actions={
            <>
              <Tip title="Definition and privileges">
                <Button
                  component={Link}
                  to={`/schemas/${schema}/${table}`}
                  variant="outlined"
                  aria-label="Definition and privileges"
                  startIcon={<Settings2 size={iconSize} />}
                />
              </Tip>
              {/* The title is drawn outside the toolbar that gives the filters to its button. */}
              <FilterContext.Provider value={filters}>
                <Tip title="Add filter">
                  <FilterButton disableSaveQuery variant="outlined" />
                </Tip>
              </FilterContext.Provider>
              <ExportCsv resource={resource} />
              {writes && columns.some((f) => f.column?.can_insert) && (
                <ImportCsv resource={resource} />
              )}
              {writes && columns.some((f) => f.column?.can_insert) && (
                // Drawn here, not as react-admin's, which floats over a phone's page instead.
                <Tip title="Insert row" labelled>
                  <Button
                    component={Link}
                    to={createPath({ resource, type: 'create' })}
                    variant="contained"
                    aria-label="Insert row"
                    startIcon={<Plus size={iconSize} />}
                  >
                    Insert row
                  </Button>
                </Tip>
              )}
            </>
          }
        />
      }
      filters={filters}
      exporter={false}
      storeKey={false}
      perPage={25}
      sort={
        columns.some((f) => f.name === 'created_at' && f.column?.can_select)
          ? { field: 'created_at', order: 'DESC' }
          : { field: shown[0]?.name ?? 'id', order: 'ASC' }
      }
      empty={false}
      aside={<TableAside />}
      actions={false}
    >
      <Table
        empty={info.rls && !info.can_alter ? 'No row that a policy lets you see' : 'No row'}
        then={
          writes &&
          columns.some((f) => f.column?.can_insert) && (
            <Button
              component={Link}
              to={createPath({ resource, type: 'create' })}
              variant="outlined"
              startIcon={<Plus size={iconSize} />}
            >
              Insert row
            </Button>
          )
        }
        rowClick={hasId ? 'edit' : false}
        bulkActionButtons={writes && info.can_delete ? <DeleteChosen /> : false}
      >
        {shown.map((column, at) => (
          <DataTable.Col
            key={column.name}
            source={column.name}
            label={column.label}
            align={column.type.numeric ? 'right' : 'left'}
            cellClassName={at === 0 && shown.length > 3 ? 'pinned' : undefined}
            headerClassName={at === 0 && shown.length > 3 ? 'pinned' : undefined}
          >
            <Value column={column} situation="list" />
          </DataTable.Col>
        ))}
      </Table>
    </List>
  )
}
