import {
  ActionIcon,
  Button,
  Card,
  Checkbox,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Tabs,
  TagsInput,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import {
  collectionStatements,
  collectionTarget,
  columnTypes,
  commentCollectionStatement,
  dropCollectionStatement,
  dropFieldStatement,
  type FieldSpec,
  fieldStatements,
  fieldsViewsStatement,
  fieldTarget,
  kindOf,
  onDeleteActions,
  situations,
  tablesIn,
} from '@platform/core'
import { Plus, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { CollectionAccess } from './access.tsx'
import {
  Change,
  Empty,
  ItemMark,
  Page,
  Problem,
  Remove,
  Section,
  Statements,
  Tag,
} from './bits.tsx'
import { type Field, useFields } from './fields.tsx'
import { FieldSayings, MetadataPanel } from './metadata.tsx'
import { usePlace, useSession } from './session.tsx'
import { useNames } from './shell.tsx'

const shortTypes: [string, string][] = [
  ['timestamp with time zone', 'timestamptz'],
  ['timestamp without time zone', 'timestamp'],
  ['character varying', 'varchar'],
  ['double precision', 'float8'],
]
const shortType = (type: string) =>
  shortTypes.reduce((text, [long, short]) => text.replace(long, short), type)

/** The collections of the workspace and their shape. */
export function ModelHome() {
  const { catalog } = useSession()
  const place = usePlace()
  const names = useNames()
  const collections = tablesIn(catalog, place.ws)
  return (
    <Page
      title={names(place.ws).name}
      crumbs={['Data model']}
      mark={<ItemMark {...names(place.ws)} size={44} />}
      actions={
        place.schema?.can_create && (
          <ActionIcon
            size={44}
            radius="xl"
            component={Link}
            to={place.to('/model/new')}
            aria-label="New collection"
            title="New collection"
          >
            <Plus />
          </ActionIcon>
        )
      }
    >
      {!collections.length && <Empty>No collection here that you may reach.</Empty>}
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Collection</Table.Th>
            <Table.Th>Fields</Table.Th>
            <Table.Th>Row security</Table.Th>
            <Table.Th>Owner</Table.Th>
            <Table.Th>What it is for</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {collections.map((t) => (
            <Table.Tr key={t.name}>
              <Table.Td>
                <Group
                  gap="sm"
                  wrap="nowrap"
                  component={Link}
                  {...{ to: place.to('/model/collection', { c: t.name }) }}
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  <ItemMark {...names(t.schema, t.name)} size={28} table />
                  <div>
                    <Text fw={600}>{names(t.schema, t.name).name}</Text>
                    <Text fz="xs" className="mono" c="dimmed">
                      {t.name}
                      {t.kind === 'v' ? ' (view)' : ''}
                    </Text>
                  </div>
                </Group>
              </Table.Td>
              <Table.Td className="mono">
                {catalog.columns.filter((c) => c.schema === t.schema && c.table === t.name).length}
              </Table.Td>
              <Table.Td>{t.rls ? <Tag color="blue">on</Tag> : <Tag>off</Tag>}</Table.Td>
              <Table.Td className="mono">{t.owner}</Table.Td>
              <Table.Td c="dimmed">{t.comment}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Page>
  )
}

const emptyField: FieldSpec = { name: '', type: 'text' }
/** A field, typed and constrained: real CHECK, NOT NULL, UNIQUE, an index, a foreign key. */
function FieldForm({ field, onChange }: { field: FieldSpec; onChange(field: FieldSpec): void }) {
  const { catalog } = useSession()
  const place = usePlace()
  const set = (changes: Partial<FieldSpec>) => onChange({ ...field, ...changes })
  const own = field.type in columnTypes || field.type === 'relation'
  const kind =
    field.type === 'relation'
      ? 'uuid'
      : own
        ? kindOf(columnTypes[field.type as keyof typeof columnTypes])
        : 'other'
  const number = (value: string | number) => (value === '' ? undefined : Number(value))
  return (
    <Stack gap="xs">
      <Group grow align="start">
        <TextInput
          label="Name"
          className="mono"
          value={field.name}
          onChange={(e) => set({ name: e.currentTarget.value })}
        />
        <Select
          label="Type"
          searchable
          allowDeselect={false}
          value={field.type}
          onChange={(type) => set({ type: type ?? 'text', relation: null, modifiers: undefined })}
          data={[
            { group: "The platform's", items: [...Object.keys(columnTypes), 'relation'] },
            // Any type the database holds, named with its schema so it means the same everywhere.
            { group: "The installation's", items: catalog.types.map((t) => t.name) },
          ]}
        />
      </Group>
      {!own && (
        <TextInput
          label="Modifiers"
          description="What the type takes, separated by commas: Point, 4326"
          value={(field.modifiers ?? []).join(', ')}
          onChange={(e) =>
            set({
              modifiers: e.currentTarget.value
                .split(',')
                .map((m) => m.trim())
                .filter(Boolean),
            })
          }
        />
      )}
      {field.type === 'relation' && (
        <Group grow>
          <Select
            label="Points at"
            data={tablesIn(catalog, place.ws)
              .filter((t) => t.kind !== 'v')
              .map((t) => t.name)}
            value={field.relation ?? null}
            onChange={(relation) => set({ relation })}
          />
          <Select
            label="When that row goes"
            allowDeselect={false}
            data={Object.keys(onDeleteActions)}
            value={field.onDelete ?? 'restrict'}
            onChange={(onDelete) => set({ onDelete: onDelete as FieldSpec['onDelete'] })}
          />
        </Group>
      )}
      <Group>
        <Checkbox
          label="Required"
          checked={!!field.required}
          onChange={(e) => set({ required: e.currentTarget.checked })}
        />
        <Checkbox
          label="Unique"
          checked={!!field.unique}
          onChange={(e) => set({ unique: e.currentTarget.checked })}
        />
        <Checkbox
          label="Indexed"
          checked={!!field.indexed}
          onChange={(e) => set({ indexed: e.currentTarget.checked })}
        />
      </Group>
      <Group grow align="start">
        {field.type !== 'relation' && (
          <TextInput
            label="Default"
            value={String(field.default ?? '')}
            onChange={(e) => set({ default: e.currentTarget.value })}
          />
        )}
        {kind === 'text' && (
          <NumberInput
            label="Longest"
            min={1}
            value={field.maxLength ?? ''}
            onChange={(n) => set({ maxLength: number(n) })}
          />
        )}
        {(kind === 'integer' || kind === 'number') && (
          <NumberInput
            label="At least"
            value={field.min ?? ''}
            onChange={(n) => set({ min: number(n) })}
          />
        )}
        {(kind === 'integer' || kind === 'number') && (
          <NumberInput
            label="At most"
            value={field.max ?? ''}
            onChange={(n) => set({ max: number(n) })}
          />
        )}
      </Group>
      {kind === 'text' && (
        <TagsInput
          label="Choices"
          description="The only values the field may hold"
          value={field.choices ?? []}
          onChange={(choices) => set({ choices })}
        />
      )}
      <TextInput
        label="Note"
        value={field.note ?? ''}
        onChange={(e) => set({ note: e.currentTarget.value })}
      />
    </Stack>
  )
}
const fieldOf = (field: FieldSpec): FieldSpec => {
  if (field.type === 'relation' && !field.relation)
    throw new Error(`${field.name || 'The relation'}: choose the collection it points at.`)
  return field
}

/** A new collection, with its fields. Created through platform.create_collection, as the reader. */
export function NewCollection() {
  const { run } = useSession()
  const place = usePlace()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [fields, setFields] = useState<FieldSpec[]>([{ ...emptyField, name: 'name' }])
  const [refusal, setRefusal] = useState<unknown>(null)
  let statements: string[] = []
  let problem = ''
  try {
    statements = collectionStatements(place.ws, name.trim(), note, fields.map(fieldOf))
  } catch (error) {
    problem = name ? (error as Error).message : 'Name the collection.'
  }
  const create = () =>
    run(statements).then(
      () => navigate(place.to('/model/collection', { c: name.trim() })),
      setRefusal
    )
  return (
    <Page
      title="New collection"
      crumbs={[
        <Link key="m" to={place.to('/model')}>
          Data model
        </Link>,
        'New',
      ]}
      actions={
        <Button disabled={!statements.length} onClick={create}>
          Create
        </Button>
      }
    >
      <Stack maw={760}>
        <Group grow>
          <TextInput
            label="Name"
            className="mono"
            description={`A table in ${place.ws}`}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <TextInput
            label="What it is for"
            description="Kept as the table's comment"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        </Group>
        <Text fz="sm" c="dimmed">
          Every collection is made with id, created_at, updated_at, created_by, updated_by and
          version, with row security on and no policy: its owner administers it, and grants alone
          show nobody a row.
        </Text>
        {fields.map((field, at) => (
          <Card key={String(at)} withBorder radius="md">
            <Group justify="space-between" mb="xs">
              <Text fw={650}>Field {at + 1}</Text>
              <Remove
                label="Leave this field out"
                onClick={() => setFields(fields.filter((_, i) => i !== at))}
              />
            </Group>
            <FieldForm
              field={field}
              onChange={(next) => setFields(fields.map((f, i) => (i === at ? next : f)))}
            />
          </Card>
        ))}
        <Button
          variant="default"
          leftSection={<Plus size={16} />}
          onClick={() => setFields([...fields, emptyField])}
        >
          Add a field
        </Button>
        {problem && (
          <Text fz="sm" c="dimmed">
            {problem}
          </Text>
        )}
        <Statements sql={statements} />
        <Problem error={refusal} />
      </Stack>
    </Page>
  )
}

/** What PostgreSQL withholds from the reader is marked, never papered over. */
const withheld = (f: Field) =>
  !f.column.can_select && !f.column.can_insert && !f.column.can_update
    ? 'hidden from you'
    : !f.column.can_select
      ? 'write-only'
      : !f.column.can_update && !f.computed && !f.system
        ? 'read-only'
        : null

/** One collection: its fields, its metadata, and its access. */
export function CollectionModel() {
  const place = usePlace()
  const names = useNames()
  const navigate = useNavigate()
  const { info, fields } = useFields(place.ws, place.c)
  const [adding, setAdding] = useState<FieldSpec | null>(null)
  const [saying, setSaying] = useState<Field | null>(null)
  const [dropping, setDropping] = useState<string | null>(null)
  const [dropAll, setDropAll] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [mending, setMending] = useState(false)
  if (!info)
    return (
      <Page title="Collection">
        <Empty>There is no collection {place.c} here that you may reach.</Empty>
      </Page>
    )
  const said = names(place.ws, place.c)
  const unsaid = fields.filter((f) => !f.hasViews)
  return (
    <Page
      title={said.name}
      crumbs={[
        <Link key="m" to={place.to('/model')}>
          Data model
        </Link>,
        <span key="c" className="mono">
          {place.ws}.{place.c}
        </span>,
      ]}
      mark={<ItemMark {...said} size={44} table />}
      actions={
        <Button
          variant="default"
          component={Link}
          to={place.to('/content/records', { c: place.c })}
        >
          Records
        </Button>
      }
    >
      <Tabs
        value={place.params.get('tab') ?? 'fields'}
        onChange={(tab) => place.set({ tab })}
        keepMounted={false}
      >
        <Tabs.List mb="lg">
          <Tabs.Tab value="fields">Fields</Tabs.Tab>
          <Tabs.Tab value="metadata">Metadata</Tabs.Tab>
          <Tabs.Tab value="access">Access</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="fields">
          <Group justify="flex-end" mb="sm">
            {info.can_alter && unsaid.length > 0 && (
              <Button variant="subtle" onClick={() => setMending(true)}>
                Give {unsaid.length} field{unsaid.length === 1 ? '' : 's'} the saying they lack
              </Button>
            )}
            {info.can_alter && (
              <Button leftSection={<Plus size={16} />} onClick={() => setAdding(emptyField)}>
                Add field
              </Button>
            )}
          </Group>
          <Table verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Field</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th>Rules</Table.Th>
                <Table.Th>Appears in</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {fields.map((f) => (
                <Table.Tr key={f.name}>
                  <Table.Td>
                    <Text fw={600}>{f.label}</Text>
                    {f.label !== f.name && (
                      <Text fz="xs" className="mono" c="dimmed">
                        {f.name}
                      </Text>
                    )}
                    {withheld(f) && <Tag color="yellow">{withheld(f)}</Tag>}
                  </Table.Td>
                  <Table.Td>
                    <Text className="mono">{shortType(f.column.type)}</Text>
                    {f.relation && (
                      <Text fz="xs" c="dimmed">
                        → <span className="mono">{f.relation.target_table}</span>
                      </Text>
                    )}
                    {f.computed && (
                      <Text fz="xs" c="dimmed">
                        computed by PostgreSQL
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {f.column.required && <Tag>required</Tag>}
                      {f.choices && <Tag>{f.choices.length} choices</Tag>}
                      {f.column.default && (
                        <Text fz="xs" className="mono" c="dimmed">
                          default {f.column.default}
                        </Text>
                      )}
                    </Group>
                    <Text fz="xs" c="dimmed">
                      {f.column.comment}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" fz="sm">
                      {situations.map((s) => (
                        <span key={s} className={f.views[s] === 'hide' ? 'struck' : undefined}>
                          {s}
                          {f.views[s] === 'readonly' ? ' (locked)' : ''}
                        </span>
                      ))}
                      {Object.entries(f.views)
                        .filter(([view]) => !situations.includes(view as 'list'))
                        .map(([view, mode]) => (
                          <span key={view} className={`mono ${mode === 'hide' ? 'struck' : ''}`}>
                            {view}
                          </span>
                        ))}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    {info.can_alter && (
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          aria-label={`What ${f.name} says of itself`}
                          title="Name, views and renderers"
                          onClick={() => setSaying(f)}
                        >
                          <Settings2 size={16} />
                        </ActionIcon>
                        {!f.system && (
                          <Remove label={`Drop ${f.name}`} onClick={() => setDropping(f.name)} />
                        )}
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {info.can_alter && (
            <Section title="Drop the collection" note="Every record goes with it.">
              <Button color="red" variant="light" onClick={() => setDropAll('')}>
                Drop {place.c}
              </Button>
            </Section>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="metadata">
          <Section
            title="What it is for"
            note="Kept as the table's comment."
            actions={
              info.can_alter && (
                <Button variant="default" onClick={() => setNote(info.comment ?? '')}>
                  Change
                </Button>
              )
            }
          >
            <Text c={info.comment ? undefined : 'dimmed'}>{info.comment ?? 'Nothing said.'}</Text>
          </Section>
          <MetadataPanel target={collectionTarget(place.ws, place.c)} canEdit={info.can_alter} />
        </Tabs.Panel>
        <Tabs.Panel value="access">
          <CollectionAccess schema={place.ws} table={place.c} fields={fields} />
        </Tabs.Panel>
      </Tabs>

      <Change
        title="Add field"
        opened={!!adding}
        onClose={() => setAdding(null)}
        statements={() => fieldStatements(place.ws, place.c, fieldOf(adding ?? emptyField))}
      >
        {adding && <FieldForm field={adding} onChange={setAdding} />}
      </Change>
      {saying && (
        <FieldSayings
          field={saying}
          target={fieldTarget(place.ws, place.c, saying.name)}
          onClose={() => setSaying(null)}
        />
      )}
      <Change
        title="Where the fields appear"
        opened={mending}
        onClose={() => setMending(false)}
        statements={() => [
          fieldsViewsStatement(unsaid.map((f) => fieldTarget(place.ws, place.c, f.name))),
        ]}
      >
        <Text fz="sm" c="dimmed">
          These fields were made before every field carried its own saying. This writes the default
          — shown everywhere — on each of them.
        </Text>
      </Change>
      <Change
        title={`Drop ${dropping}`}
        danger
        label="Drop"
        opened={!!dropping}
        onClose={() => setDropping(null)}
        statements={() => [dropFieldStatement(place.ws, place.c, dropping ?? '')]}
      >
        <Text fz="sm" c="dimmed">
          The column and every value in it are gone when this runs.
        </Text>
      </Change>
      <Change
        title="What it is for"
        opened={note !== null}
        onClose={() => setNote(null)}
        statements={() => [commentCollectionStatement(place.ws, place.c, note ?? '')]}
      >
        <Textarea autosize value={note ?? ''} onChange={(e) => setNote(e.currentTarget.value)} />
      </Change>
      <Change
        title={`Drop ${place.c}`}
        danger
        label="Drop"
        opened={dropAll !== null}
        ready={dropAll === place.c}
        onClose={() => setDropAll(null)}
        done={() => navigate(place.to('/model'))}
        statements={() => [dropCollectionStatement(place.ws, place.c)]}
      >
        <TextInput
          label="Every record goes with it. Type the collection's name to confirm."
          className="mono"
          value={dropAll ?? ''}
          onChange={(e) => setDropAll(e.currentTarget.value)}
        />
      </Change>
    </Page>
  )
}
