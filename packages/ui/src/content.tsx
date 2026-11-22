import {
  ActionIcon,
  Button,
  Card,
  Group,
  Modal,
  Pill,
  Popover,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Timeline,
} from '@mantine/core'
import { useForm } from '@mantine/form'
import { useDebouncedCallback } from '@mantine/hooks'
import { notifications } from '@mantine/notifications'
import {
  activity,
  type Condition,
  deleteRecord,
  type Filter,
  type Hold,
  insertRecord,
  type Operator,
  operators,
  policies,
  record,
  records,
  relationLabels,
  sqlState,
  tablesIn,
  transaction,
  updateRecord,
  valueless,
} from '@platform/core'
import { Filter as FilterIcon, Plus, Save, Search, Trash2 } from 'lucide-react'
import { DataTable } from 'mantine-datatable'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Empty, ItemMark, Page, Privilege, Problem, Section, Tag } from './bits.tsx'
import { type Field, filterValue, operatorWords, textOf, useFields, Value } from './fields.tsx'
import { useDb, usePlace, useSession } from './session.tsx'
import { useNames } from './shell.tsx'

type Row = Record<string, unknown>

/** The collections of the workspace in view, as an entry point. */
export function ContentHome() {
  const { catalog } = useSession()
  const place = usePlace()
  const names = useNames()
  const collections = tablesIn(catalog, place.ws)
  return (
    <Page
      title={names(place.ws).name}
      crumbs={['Content']}
      mark={<ItemMark {...names(place.ws)} size={44} />}
    >
      {!place.ws && <Empty>The database gives you USAGE on no workspace yet.</Empty>}
      {place.ws && !collections.length && <Empty>No collection here that you may reach.</Empty>}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {collections.map((t) => {
          const said = names(t.schema, t.name)
          return (
            <Card
              key={t.name}
              withBorder
              radius="md"
              component={Link}
              to={place.to('/content/records', { c: t.name })}
            >
              <Group wrap="nowrap" align="start">
                <ItemMark {...said} table />
                <div>
                  <Text fw={650}>{said.name}</Text>
                  <Text fz="sm" c="dimmed" lineClamp={2}>
                    {t.comment ?? (
                      <span className="mono">
                        {t.schema}.{t.name}
                      </span>
                    )}
                  </Text>
                </div>
              </Group>
            </Card>
          )
        })}
      </SimpleGrid>
    </Page>
  )
}

/** The reader's own rights on a collection and the row policies that apply to them. */
export function CollectionAside({
  schema,
  table,
  fields,
}: {
  schema: string
  table: string
  fields: Field[]
}) {
  const { catalog } = useSession()
  const info = catalog.tables.find((t) => t.schema === schema && t.name === table)
  const rules = useDb(['policies', schema, table], (db) => policies(db, schema, table))
  if (!info) return null
  const held = (
    whole: boolean,
    right: 'can_select' | 'can_insert' | 'can_update'
  ): [Hold, string] => {
    const some = fields.filter((f) => f.column[right]).length
    return [whole ? 'all' : some ? 'some' : 'none', `${some}/${fields.length}`]
  }
  const applying = (rules.data ?? []).filter((p) => p.applies)
  return (
    <Stack gap="lg">
      <div>
        <Text fw={650} mb={4}>
          Collection
        </Text>
        <Text fz="sm" c="dimmed">
          {info.comment}
        </Text>
        <Text fz="sm" className="mono">
          {schema}.{table}
        </Text>
        <Text fz="sm" c="dimmed">
          Owned by <span className="mono">{info.owner}</span>
        </Text>
      </div>
      <div>
        <Text fw={650} mb={4}>
          What you may do
        </Text>
        <Stack gap={4}>
          {info.can_alter && <Tag color="dark">owner</Tag>}
          {(['SELECT', 'INSERT', 'UPDATE'] as const).map((name) => {
            const [hold, count] = held(
              info[`can_${name.toLowerCase()}` as 'can_select'],
              `can_${name.toLowerCase()}` as 'can_select'
            )
            return <Privilege key={name} name={name} held={hold} count={count} />
          })}
          <Privilege name="DELETE" held={info.can_delete} />
        </Stack>
      </div>
      <div>
        <Text fw={650} mb={4}>
          Row security
        </Text>
        {!info.rls && (
          <Text fz="sm" c="dimmed">
            Row security is off: grants alone decide which rows you reach.
          </Text>
        )}
        {info.rls && !applying.length && (
          <Text fz="sm" c="dimmed">
            {info.can_alter
              ? 'No policy applies to you; as an owner you are not held to them.'
              : 'No policy applies to you: PostgreSQL shows you no row.'}
          </Text>
        )}
        {applying.map((p) => (
          <div key={p.name}>
            <Text fz="sm">
              <span className="mono">{p.name}</span> <Tag color="blue">{p.command}</Tag>
            </Text>
            <Text fz="xs" className="mono" c="blue.8">
              {p.using ?? p.check}
            </Text>
          </div>
        ))}
      </div>
    </Stack>
  )
}

const pageSizes = [25, 50, 100]
/** The records of a collection: search, filters, sort, pages and a count — all kept in the address. */
export function Records() {
  const { catalog, db, refresh } = useSession()
  const place = usePlace()
  const names = useNames()
  const navigate = useNavigate()
  const { info, fields, loading } = useFields(place.ws, place.c)
  const [selected, setSelected] = useState<Row[]>([])
  const [confirming, setConfirming] = useState(false)
  const [refusal, setRefusal] = useState<unknown>(null)
  const search = useDebouncedCallback((q: string) => place.set({ q, page: null }), 300)

  const readable = fields.filter((f) => f.column.can_select)
  const shown = readable.filter((f) => f.views.list !== 'hide')
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]))
  const hasId = readable.some((f) => f.name === 'id')
  const filter: Filter = {}
  for (const [key, value] of place.params) {
    if (!key.startsWith('f.')) continue
    const [op, ...rest] = value.split('.')
    if (!operators.includes(op as Operator)) continue
    filter[key.slice(2)] = {
      op: op as Operator,
      value: filterValue(byName[key.slice(2)], op as Operator, rest.join('.')),
    }
  }
  const q = place.params.get('q') ?? ''
  const sort = place.params.get('sort') ?? ''
  const page = Number(place.params.get('page')) || 1
  const size = Number(place.params.get('size')) || pageSizes[0]!
  const columns = [
    ...new Set([
      ...shown.map((f) => f.name),
      ...(hasId ? ['id'] : []),
      ...(readable.some((f) => f.name === 'version') ? ['version'] : []),
    ]),
  ]
  const found = useDb(
    ['records', place.ws, place.c, columns, place.params.toString()],
    async (session) => {
      const result = await records(session, {
        schema: place.ws,
        table: place.c,
        columns,
        filter,
        search: q,
        sort: sort ? [sort] : [],
        searchable: readable.map((f) => f.name),
        limit: size,
        offset: (page - 1) * size,
      })
      const relations = shown.filter((f) => f.relation).map((f) => f.name)
      return {
        ...result,
        labels: await relationLabels(session, catalog, place.ws, place.c, result.rows, relations),
      }
    },
    !!info && !loading && columns.length > 0
  )

  if (!info)
    return (
      <Page title="Records">
        <Empty>There is no collection {place.c} here that you may reach.</Empty>
      </Page>
    )
  const said = names(place.ws, place.c)
  const remove = async () => {
    try {
      await db.exclusive((one) =>
        transaction(one, async () => {
          for (const row of selected) await deleteRecord(one, place.ws, place.c, String(row.id))
        })
      )
      notifications.show({
        color: 'green',
        message: `Deleted ${selected.length} record${selected.length === 1 ? '' : 's'}.`,
      })
      setSelected([])
      setConfirming(false)
      await refresh()
    } catch (error) {
      setRefusal(error)
    }
  }
  return (
    <Page
      title={said.name}
      crumbs={[
        <Link key="c" to={place.to('/content')}>
          {names(place.ws).name}
        </Link>,
        'Records',
      ]}
      mark={<ItemMark {...said} size={44} table />}
      aside={<CollectionAside schema={place.ws} table={place.c} fields={fields} />}
      actions={
        <>
          {selected.length > 0 && (
            <Button
              color="red"
              variant="light"
              leftSection={<Trash2 size={16} />}
              onClick={() => setConfirming(true)}
            >
              Delete {selected.length}
            </Button>
          )}
          {fields.some((f) => f.column.can_insert) && info.kind !== 'v' && hasId && (
            <ActionIcon
              size={44}
              radius="xl"
              component={Link}
              to={place.to('/content/item', { c: place.c })}
              aria-label="New record"
              title="New record"
            >
              <Plus />
            </ActionIcon>
          )}
        </>
      }
    >
      <Group mb="sm">
        <TextInput
          placeholder="Search every readable column"
          leftSection={<Search size={16} />}
          radius="xl"
          w={320}
          defaultValue={q}
          onChange={(e) => search(e.currentTarget.value)}
        />
        <FilterBuilder
          fields={readable.filter((f) => f.views.filter !== 'hide')}
          add={(name, one) => place.set({ [`f.${name}`]: `${one.op}.${one.value}`, page: null })}
        />
        {Object.entries(filter).map(([name, one]) => (
          <Pill
            key={name}
            size="lg"
            withRemoveButton
            onRemove={() => place.set({ [`f.${name}`]: null, page: null })}
          >
            {byName[name]?.label ?? name} {operatorWords[one.op]}{' '}
            {valueless.includes(one.op) ? (
              ''
            ) : (
              <span className="mono">{textOf([one.value].flat().join(', '))}</span>
            )}
          </Pill>
        ))}
      </Group>
      <Problem error={found.error} />
      <DataTable<Row>
        withTableBorder
        borderRadius="md"
        minHeight={180}
        highlightOnHover
        pinFirstColumn={shown.length > 3}
        fetching={found.isFetching}
        records={found.data?.rows ?? []}
        idAccessor={(row) => String(row.id ?? JSON.stringify(row))}
        noRecordsText={
          info.rls && !info.can_alter ? 'No row that a policy lets you see.' : 'No records.'
        }
        columns={shown.map((field) => ({
          accessor: field.name,
          title: field.label,
          sortable: true,
          textAlign: field.type.numeric ? 'right' : 'left',
          // A value longer than its column ends in an ellipsis; the whole value is in its hint.
          render: (row: Row) => (
            <div className="cell">
              <Value
                field={field}
                value={row[field.name]}
                situation="list"
                label={found.data?.labels[field.name]?.[String(row[field.name])]}
              />
            </div>
          ),
        }))}
        sortStatus={{
          columnAccessor: sort.replace(/^-/, ''),
          direction: sort.startsWith('-') ? 'desc' : 'asc',
        }}
        onSortStatusChange={(status) =>
          place.set({
            sort: `${status.direction === 'desc' ? '-' : ''}${status.columnAccessor}`,
            page: null,
          })
        }
        totalRecords={found.data?.total ?? 0}
        recordsPerPage={size}
        recordsPerPageOptions={pageSizes}
        onRecordsPerPageChange={(next) => place.set({ size: String(next), page: null })}
        page={page}
        onPageChange={(next) => place.set({ page: String(next) }, false)}
        paginationText={({ from, to, totalRecords }) => `${from}–${to} of ${totalRecords}`}
        {...(hasId
          ? {
              onRowClick: ({ record: row }: { record: Row }) =>
                navigate(place.to('/content/item', { c: place.c, id: String(row.id) })),
            }
          : {})}
        {...(hasId && info.can_delete
          ? { selectedRecords: selected, onSelectedRecordsChange: setSelected }
          : {})}
      />
      <Modal
        opened={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${selected.length} record${selected.length === 1 ? '' : 's'}?`}
      >
        <Text fz="sm" c="dimmed">
          They are deleted in one transaction; a row policy that refuses one refuses all.
        </Text>
        <Problem error={refusal} />
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button color="red" onClick={remove}>
            Delete
          </Button>
        </Group>
      </Modal>
    </Page>
  )
}

/** One condition at a time: a field, one of the operators its type offers, and a value. */
function FilterBuilder({
  fields,
  add,
}: {
  fields: Field[]
  add: (name: string, condition: Condition) => void
}) {
  const [opened, setOpened] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [op, setOp] = useState<Operator | null>(null)
  const [value, setValue] = useState('')
  const field = fields.find((f) => f.name === name)
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" withArrow>
      <Popover.Target>
        <Button
          variant="default"
          leftSection={<FilterIcon size={16} />}
          onClick={() => setOpened(!opened)}
        >
          Filter
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" w={280}>
          <Text fw={600} fz="sm">
            Show rows where
          </Text>
          <Select
            placeholder="Field"
            searchable
            data={fields.map((f) => ({ value: f.name, label: f.label }))}
            value={name}
            onChange={(next) => {
              setName(next)
              setOp(null)
            }}
            comboboxProps={{ withinPortal: false }}
          />
          <Select
            placeholder="Condition"
            data={(field?.type.operators ?? []).map((o) => ({ value: o, label: operatorWords[o] }))}
            value={op}
            onChange={(next) => setOp(next as Operator)}
            comboboxProps={{ withinPortal: false }}
          />
          {op && !valueless.includes(op) && (
            <TextInput
              placeholder={op === 'in' || op === 'not_in' ? 'Values, separated by commas' : 'Value'}
              value={value}
              onChange={(e) => setValue(e.currentTarget.value)}
            />
          )}
          <Button
            disabled={!name || !op}
            onClick={() => {
              add(name!, { op: op!, value })
              setOpened(false)
              setValue('')
            }}
          >
            Add filter
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

/** One record: read it, edit it, delete it, or write a new one. */
export function Item() {
  const { db, refresh } = useSession()
  const place = usePlace()
  const names = useNames()
  const navigate = useNavigate()
  const { info, fields, loading } = useFields(place.ws, place.c)
  const id = place.id
  const readable = fields.filter((f) => f.column.can_select).map((f) => f.name)
  const loaded = useDb(
    ['record', place.ws, place.c, id, readable],
    (one) => record(one, place.ws, place.c, readable, id),
    !!id && !loading && readable.length > 0
  )
  const history = useDb(
    ['revisions', place.ws, place.c, id],
    (one) => activity(one, { schema: place.ws, table: place.c, row: id, limit: 20 }),
    !!id
  )
  const [refusal, setRefusal] = useState<unknown>(null)
  const [deleting, setDeleting] = useState(false)
  const row = loaded.data as Row | null | undefined

  // A field is an input when PostgreSQL would take the write and its owner has not locked it.
  const writable = (f: Field) =>
    !f.system &&
    !f.computed &&
    f.views.record !== 'readonly' &&
    (id ? f.column.can_update : f.column.can_insert)
  const inForm = fields.filter((f) => !f.system && f.views.record !== 'hide')
  const form = useForm<Row>({ mode: 'controlled', initialValues: {} })
  const [seeded, setSeeded] = useState<string | null>(null)
  const seed = `${place.c}/${id}/${row ? row.version : ''}/${loading}`
  // The form is drawn once it holds the record, so nothing the reader types is overwritten by it.
  if (seeded !== seed && !loading && (!id || row)) {
    // A new record may start from what the address says: v.<field>=…
    const start = Object.fromEntries(
      inForm.map((f) => [
        f.name,
        f.type.toForm
          ? f.type.toForm(row?.[f.name] ?? null)
          : textOf(row?.[f.name] ?? place.params.get(`v.${f.name}`) ?? ''),
      ])
    )
    for (const f of inForm)
      if (!id && place.params.has(`v.${f.name}`)) start[f.name] = place.params.get(`v.${f.name}`)
    form.setInitialValues(start)
    form.setValues(start)
    setSeeded(seed)
  }
  if (!info)
    return (
      <Page title="Record">
        <Empty>There is no collection {place.c} here that you may reach.</Empty>
      </Page>
    )
  // The record form goes back to where the reader came from: a page of the interface, nowhere else.
  const from = place.params.get('from')
  const back =
    from?.startsWith('/') && !from.startsWith('//')
      ? from
      : place.to('/content/records', { c: place.c })
  const said = names(place.ws, place.c)

  const save = async () => {
    setRefusal(null)
    const values: Row = {}
    for (const f of inForm.filter(writable)) {
      if (id ? !form.isDirty(f.name) : form.values[f.name] === '' || form.values[f.name] === null)
        continue
      try {
        values[f.name] = f.type.fromForm
          ? f.type.fromForm(form.values[f.name], f)
          : form.values[f.name]
      } catch (error) {
        return form.setFieldError(f.name, (error as Error).message)
      }
    }
    try {
      if (!id) {
        await insertRecord(db, place.ws, place.c, values)
        notifications.show({ color: 'green', message: 'The record was written.' })
        await refresh()
        return navigate(back)
      }
      if (!Object.keys(values).length) return
      const changed = await updateRecord(
        db,
        place.ws,
        place.c,
        id,
        values,
        row?.version as number | undefined
      )
      if (!changed) {
        // No row: a newer version means someone else wrote first; otherwise a policy refused it or the row is gone.
        const now = (await record(db, place.ws, place.c, readable, id)) as Row | null
        throw new Error(
          now && now.version !== row?.version
            ? 'Someone changed this record since you opened it. Read it again before saving.'
            : 'PostgreSQL changed no row: a row policy refused the change, or the row is gone.'
        )
      }
      notifications.show({ color: 'green', message: 'Saved.' })
      await refresh()
    } catch (error) {
      setRefusal(
        sqlState(error) === '23505' && place.c === 'item_metadata'
          ? new Error('An item carries a key once: this one is already there.')
          : error
      )
    }
  }
  const remove = async () => {
    try {
      if (!(await deleteRecord(db, place.ws, place.c, id, row?.version as number | undefined)))
        throw new Error(
          'PostgreSQL deleted no row: it changed since you opened it, or a row policy refused.'
        )
      await refresh()
      navigate(back)
    } catch (error) {
      setRefusal(error)
      setDeleting(false)
    }
  }
  const system = fields.filter((f) => f.system && f.column.can_select)
  return (
    <Page
      title={
        id
          ? textOf(
              row?.[
                fields.find((f) => f.kind === 'text' && !f.system && f.column.can_select)?.name ??
                  'id'
              ]
            ) || 'Record'
          : `New in ${said.name}`
      }
      crumbs={[
        <Link key="c" to={back}>
          {said.name}
        </Link>,
        id ? 'Record' : 'New',
      ]}
      mark={<ItemMark {...said} size={44} table />}
      actions={
        <>
          {id && info.can_delete && (
            <ActionIcon
              size={44}
              radius="xl"
              variant="light"
              color="red"
              aria-label="Delete"
              title="Delete"
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={20} />
            </ActionIcon>
          )}
          {inForm.some(writable) && (
            <ActionIcon
              size={44}
              radius="xl"
              aria-label="Save"
              title="Save"
              onClick={save}
              disabled={!!id && !form.isDirty()}
            >
              <Save size={20} />
            </ActionIcon>
          )}
        </>
      }
      aside={
        id ? (
          <Stack gap="lg">
            <Table withRowBorders={false} verticalSpacing={4}>
              <Table.Tbody>
                {system.map((f) => (
                  <Table.Tr key={f.name}>
                    <Table.Td c="dimmed" fz="sm">
                      {f.label}
                    </Table.Td>
                    <Table.Td>
                      <Value field={f} value={row?.[f.name]} situation="record" />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {!!history.data?.length && (
              <div>
                <Text fw={650} mb="xs">
                  Revisions
                </Text>
                <Timeline bulletSize={10} lineWidth={1}>
                  {history.data.map((h) => (
                    <Timeline.Item
                      key={h.id}
                      title={
                        <Text fz="sm">
                          {h.operation} by <span className="mono">{h.actor}</span>
                        </Text>
                      }
                    >
                      <Text fz="xs" c="dimmed" className="mono">
                        {h.at.slice(0, 16)}
                      </Text>
                    </Timeline.Item>
                  ))}
                </Timeline>
              </div>
            )}
          </Stack>
        ) : (
          <CollectionAside schema={place.ws} table={place.c} fields={fields} />
        )
      }
    >
      <Problem error={loaded.error ?? refusal} />
      {id && loaded.isSuccess && !row && (
        <Empty>
          No such record that you may read: it is gone, or a row policy keeps it from you.
        </Empty>
      )}
      <Stack maw={720}>
        {seeded === seed &&
          inForm.map((f) => {
            const label = (
              <Group gap={6}>
                {f.label}
                {f.label !== f.name && (
                  <span className="mono" style={{ color: '#717273' }}>
                    {f.name}
                  </span>
                )}
              </Group>
            )
            if (writable(f))
              return (
                <div key={f.name}>
                  <f.type.Input
                    field={f}
                    label={label}
                    value={form.values[f.name] ?? ''}
                    onChange={(value) => form.setFieldValue(f.name, value)}
                    error={form.errors[f.name]}
                  />
                  {!f.column.can_select && (
                    <Text fz="xs" c="dimmed">
                      write-only: you may set it, and PostgreSQL will not show it to you
                    </Text>
                  )}
                </div>
              )
            return (
              <div key={f.name}>
                <Text fz="sm" fw={500}>
                  {label}
                </Text>
                {f.column.can_select ? (
                  <Value field={f} value={row?.[f.name]} situation="record" />
                ) : (
                  <Text fz="sm" c="dimmed">
                    hidden from you
                  </Text>
                )}
                {f.column.can_select && id && (
                  <Text fz="xs" c="dimmed">
                    {f.computed
                      ? 'PostgreSQL computes it'
                      : f.views.record === 'readonly'
                        ? 'locked by the owner of the collection'
                        : 'read-only for you'}
                  </Text>
                )}
              </div>
            )
          })}
        {fields.some((f) => !f.system && f.views.record === 'hide') && (
          <Text fz="sm" c="dimmed">
            The owner keeps{' '}
            {fields
              .filter((f) => !f.system && f.views.record === 'hide')
              .map((f) => f.label)
              .join(', ')}{' '}
            out of this form.
          </Text>
        )}
      </Stack>
      {!id && (
        <Section
          title=""
          note="A write reports how many rows it touched and returns nothing: the right to write a column is not a right to read it back."
        >
          {null}
        </Section>
      )}
      <Modal opened={deleting} onClose={() => setDeleting(false)} title="Delete this record?">
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDeleting(false)}>
            Cancel
          </Button>
          <Button color="red" onClick={remove}>
            Delete
          </Button>
        </Group>
      </Modal>
    </Page>
  )
}
