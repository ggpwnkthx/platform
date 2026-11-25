import { Box, Button } from '@mui/material'
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
import { Value } from '../fields/renderers.tsx'
import type { Field } from '../fields/types.ts'
import { ItemMark, iconSize } from '../kit/marks.tsx'
import { Tip } from '../kit/Header.tsx'
import { PageTitle } from '../kit/Page.tsx'
import { Table } from '../kit/Table.tsx'
import { CollectionAside } from './Aside.tsx'
import { operatorWords, useCollection } from './collection.ts'

/** One condition of the filter: a field, the operator it is held to, and the value it is given. */
function Condition({
  field,
  source,
}: {
  field: Field
  source: string
  label: string
  defaultValue: object
}) {
  const op = useWatch({ name: `${source}.op` })
  const value = useWatch({ name: `${source}.value` })
  const { setValue } = useFormContext()
  const many =
    ['in', 'not_in', 'has_any', 'has_none', 'has_all'].includes(op) && field.type.name !== 'text'
  // A condition on several rows holds a list; any other holds one value.
  useEffect(() => {
    if (many !== Array.isArray(value)) setValue(`${source}.value`, many ? [] : '')
  }, [many, value, setValue, source])
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }} data-condition={source}>
      <SelectInput
        source={`${source}.op`}
        label={field.label}
        helperText={false}
        choices={field.type.operators.map((id) => ({ id, name: operatorWords[id] }))}
        validate={(chosen) => (chosen ? undefined : 'Required')}
      />
      {!valueless.includes(op) && many === Array.isArray(value) && (
        <field.type.Input field={field} source={`${source}.value`} label="Value" op={op} />
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

/** The records of a collection: search, filters, sort, pages and a count — all kept in the address. */
export function RecordList() {
  const { resource, schema, table, fields, info, said, workspace, hasId } = useCollection()
  const createPath = useCreatePath()
  if (!info) return <PageTitle title={table} crumb="No such collection that you may reach" />
  const shown = fields.filter((f) => f.column?.can_select && f.views.list !== 'hide')
  const filters = [
    <SearchInput key="q" source="q" alwaysOn placeholder="Search the fields you may read" />,
    ...fields
      .filter((f) => f.views.filter !== 'hide' && (f.virtual || f.column?.can_select))
      .map((f) => (
        <Condition
          key={f.name}
          field={f}
          source={f.name}
          label={f.label}
          defaultValue={{ op: f.type.operators[0], value: '' }}
        />
      )),
  ]
  const writes = info.kind !== 'v' && hasId
  return (
    <List
      resource={resource}
      title={
        <PageTitle
          title={said.name}
          crumb={workspace.name}
          mark={<ItemMark {...said} table />}
          actions={
            <>
              <Tip title="Data model and access">
                <Button
                  component={Link}
                  to={`/w/${schema}/${table}`}
                  variant="outlined"
                  aria-label="Data model and access"
                  startIcon={<Settings2 size={iconSize} />}
                />
              </Tip>
              {/* The title is drawn outside the toolbar that gives the filters to its button. */}
              <FilterContext.Provider value={filters}>
                <Tip title="Add filter">
                  <FilterButton disableSaveQuery variant="outlined" />
                </Tip>
              </FilterContext.Provider>
              {writes && fields.some((f) => f.column?.can_insert) && (
                // Drawn here, not as react-admin's, which floats over a phone's page instead.
                <Tip title="Add a record" labelled>
                  <Button
                    component={Link}
                    to={createPath({ resource, type: 'create' })}
                    variant="contained"
                    aria-label="Add a record"
                    startIcon={<Plus size={iconSize} />}
                  >
                    Add a record
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
        fields.some((f) => f.name === 'created_at' && f.column?.can_select)
          ? { field: 'created_at', order: 'DESC' }
          : { field: shown[0]?.name ?? 'id', order: 'ASC' }
      }
      empty={false}
      aside={<CollectionAside />}
      actions={false}
    >
      <Table
        empty={info.rls && !info.can_alter ? 'No record that a policy lets you see' : 'No record'}
        then={
          writes &&
          fields.some((f) => f.column?.can_insert) && (
            <Button
              component={Link}
              to={createPath({ resource, type: 'create' })}
              variant="outlined"
              startIcon={<Plus size={iconSize} />}
            >
              Add a record
            </Button>
          )
        }
        rowClick={hasId ? 'edit' : false}
        bulkActionButtons={writes && info.can_delete ? <DeleteChosen /> : false}
      >
        {shown.map((field, at) => (
          <DataTable.Col
            key={field.name}
            source={field.name}
            label={field.label}
            align={field.type.numeric ? 'right' : 'left'}
            cellClassName={at === 0 && shown.length > 3 ? 'pinned' : undefined}
            headerClassName={at === 0 && shown.length > 3 ? 'pinned' : undefined}
          >
            <Value field={field} situation="list" />
          </DataTable.Col>
        ))}
      </Table>
    </List>
  )
}
