import {
  Anchor,
  Badge,
  Code,
  JsonInput,
  NumberInput,
  Progress,
  Select,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import {
  type Catalog,
  choicesOf,
  type ColumnInfo,
  columnsOf,
  everyView,
  fieldMetadata,
  type FieldRenderers,
  type FieldViews,
  indexFields,
  type Kind,
  kindOf,
  labelColumn,
  type MetadataRow,
  type Operator,
  type RelationInfo,
  relationOf,
  relationOptions,
  systemFields,
  tableOf,
  valueless,
} from '@platform/core'
import { Check, Minus } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useDb, useSession } from './session.tsx'

export { familyOf, isIcon, ItemIcon, tone } from './bits.tsx'

/**
 * A field is a column PostgreSQL holds, met in three situations: a cell in the records grid,
 * a value or an input in the record form, a condition in the filter builder. A field type owns
 * all of it; a renderer may take over the drawing of one situation. Both draw and read —
 * PostgreSQL has already decided who may read a value and who may write it.
 */
export interface Field {
  name: string
  label: string
  column: ColumnInfo
  kind: Kind
  relation?: RelationInfo
  choices: string[] | null
  /** A column every collection is made with. */
  system: boolean
  /** A column PostgreSQL writes itself: shown, never offered as an input. */
  computed: boolean
  views: FieldViews
  /** Whether the field carries its own saying of where it appears, or the default is assumed. */
  hasViews: boolean
  renderers: FieldRenderers
  type: FieldType
}
export interface DrawProps {
  value: unknown
  field: Field
  situation: string
  options: Record<string, unknown>
  /** The name of the row a relation points at, where the reader may read it. */
  label?: string
}
export interface InputProps {
  field: Field
  value: unknown
  onChange(value: unknown): void
  error?: ReactNode
  label?: ReactNode
}
export interface FieldType {
  name: string
  label: string
  /** How strongly the type claims a column; the greatest wins, the last added breaks a tie. */
  claims(field: Omit<Field, 'type'>): number
  draw: { list(props: DrawProps): ReactNode; record(props: DrawProps): ReactNode }
  numeric?: boolean
  Input(props: InputProps): ReactNode
  /** What the form holds for a stored value. */
  toForm?(value: unknown): unknown
  /** The value a column receives from what the form holds; throwing refuses it. */
  fromForm?(held: unknown, field: Field): unknown
  operators: Operator[]
  /** The value a condition carries, from what was typed. */
  parseFilter?(text: string): unknown
}

export const textOf = (value: unknown): string =>
  value === null || value === undefined
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)
export const numberOf = (value: unknown): number | null =>
  value === null || value === '' || Number.isNaN(Number(value)) ? null : Number(value)
export const grouped = (value: unknown) => {
  const n = numberOf(value)
  return n === null
    ? textOf(value)
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }).format(n)
}
const minute = (value: unknown) =>
  textOf(value).replace(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}).*$/, '$1 $2')
const Mono = ({ children, title }: { children: ReactNode; title?: string }) => (
  <span className="mono" title={title}>
    {children}
  </span>
)
const Clipped = ({ text, length = 60 }: { text: string; length?: number }) => (
  <span title={text}>{text.length > length ? `${text.slice(0, length)}…` : text}</span>
)

/** A listed value's colour follows what the word means, never its place in the list. */
const meanings: [RegExp, string][] = [
  [
    /^(published|active|paid|done|won|approved|complete|completed|customer|closed[ _-]won)$/,
    'green',
  ],
  [
    /^(lost|rejected|closed|blocked|cancelled|canceled|failed|archived|churned|closed[ _-]lost)$/,
    'red',
  ],
  [/^(review|negotiat\w*|partner|in[ _-]progress|qualified|proposal)$/, 'yellow'],
  [/^(draft|new|pending|lead|prospect|open)$/, 'gray'],
]
export const Choice = ({ value }: { value: unknown }) => (
  <Badge
    variant="light"
    radius="xl"
    tt="none"
    color={meanings.find(([word]) => word.test(textOf(value).toLowerCase()))?.[1] ?? 'blue'}
  >
    {textOf(value)}
  </Badge>
)

// --------------------------------------------------------------------------- field types

const line = (props: InputProps, more: object = {}) => (
  <TextInput
    label={props.label}
    error={props.error}
    value={textOf(props.value)}
    onChange={(e) => props.onChange(e.currentTarget.value)}
    {...more}
  />
)
const blankIsNull = (held: unknown) => (held === '' || held === undefined ? null : held)
const comparable: Operator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null']
const ofKind = (kind: Kind) => (field: Omit<Field, 'type'>) => (field.kind === kind ? 10 : 0)
/** What the browser is told of an input whose value is kept as PostgreSQL writes it. */
const writtenAs: Partial<Record<Kind, object>> = {
  date: { type: 'date' },
  time: { type: 'time', step: 1 },
  moment: { placeholder: '2026-01-31 09:30:00+00' },
}
const WrittenInput = (props: InputProps) =>
  line(props, { className: 'mono', ...writtenAs[props.field.kind] })
const NumberField = (props: InputProps) => (
  <NumberInput
    label={props.label}
    error={props.error}
    value={props.value as number | string}
    onChange={props.onChange}
    allowDecimal={props.field.kind === 'number'}
  />
)
const written = (kind: Kind, label: string): FieldType => ({
  name: kind,
  label,
  claims: ofKind(kind),
  draw: {
    list: ({ value }) => <Mono>{minute(value)}</Mono>,
    record: ({ value }) => <Mono>{textOf(value)}</Mono>,
  },
  Input: WrittenInput,
  fromForm: blankIsNull,
  operators: comparable,
})

function RelationInput({ field, value, onChange, error, label }: InputProps) {
  const { catalog, presentations } = useSession()
  const [search, setSearch] = useState('')
  const { target_schema: schema, target_table: table } = field.relation!
  const shown = labelColumn(
    catalog,
    schema,
    table,
    presentations[`${schema}.${table}`]?.displayField
  )
  const options = useDb(['relation', schema, table, search], (db) =>
    relationOptions(db, schema, table, shown, search)
  )
  const data = (options.data ?? []).map((row) => ({ value: row.id, label: row.label ?? row.id }))
  if (value && !data.some((row) => row.value === value))
    data.unshift({ value: String(value), label: String(value) })
  return (
    <Select
      label={label}
      error={
        error ??
        (options.error ? 'The rows it may point at are not yours to read: give an id.' : undefined)
      }
      data={data}
      value={value ? String(value) : null}
      onChange={(id) => onChange(id ?? '')}
      searchable
      clearable
      searchValue={search}
      onSearchChange={setSearch}
      filter={({ options: all }) => all}
      placeholder={`A row of ${table}`}
      nothingFoundMessage="No row matches"
    />
  )
}

const types: FieldType[] = []
/** Adds a field type; one that takes the name of a type already held replaces it. */
export function registerFieldType(type: FieldType) {
  const held = types.findIndex((one) => one.name === type.name)
  if (held >= 0) types.splice(held, 1)
  types.push(type)
}
export const fieldTypeNamed = (name: string) => types.find((type) => type.name === name)
const fieldTypeFor = (field: Omit<Field, 'type'>) =>
  types.reduce((best, type) => (type.claims(field) >= best.claims(field) ? type : best))

for (const type of [
  {
    name: 'other',
    label: 'Any value',
    claims: () => 1,
    draw: {
      list: ({ value }) => (
        <Mono>
          <Clipped text={textOf(value)} />
        </Mono>
      ),
      record: ({ value }) => <Mono>{textOf(value)}</Mono>,
    },
    Input: (props) => line(props, { className: 'mono' }),
    fromForm: blankIsNull,
    operators: ['contains', 'eq', 'neq', 'is_null', 'not_null'],
  },
  {
    name: 'text',
    label: 'Text',
    claims: ofKind('text'),
    draw: {
      list: ({ value }) => <Clipped text={textOf(value)} />,
      record: ({ value }) => <Text style={{ whiteSpace: 'pre-wrap' }}>{textOf(value)}</Text>,
    },
    Input: (props) =>
      /(^|_)(body|notes?|description|content|summary|text)$/.test(props.field.name) ? (
        <Textarea
          label={props.label}
          error={props.error}
          autosize
          minRows={3}
          value={textOf(props.value)}
          onChange={(e) => props.onChange(e.currentTarget.value)}
        />
      ) : (
        line(props)
      ),
    fromForm: blankIsNull,
    operators: [
      'contains',
      'eq',
      'neq',
      'starts_with',
      'ends_with',
      'in',
      'not_in',
      'is_null',
      'not_null',
    ],
  },
  ...(['integer', 'number'] as const).map(
    (kind): FieldType => ({
      name: kind,
      label: kind === 'integer' ? 'Whole number' : 'Number',
      claims: ofKind(kind),
      numeric: true,
      draw: {
        list: ({ value }) => <Mono>{textOf(value)}</Mono>,
        record: ({ value }) => <Mono>{grouped(value)}</Mono>,
      },
      Input: NumberField,
      toForm: (value) => value ?? '',
      fromForm: blankIsNull,
      operators: comparable,
      parseFilter: (text) => numberOf(text) ?? text,
    })
  ),
  {
    name: 'boolean',
    label: 'Yes or no',
    claims: ofKind('boolean'),
    draw: {
      list: ({ value }) =>
        value === null ? null : value ? (
          <Check size={16} aria-label="yes" />
        ) : (
          <Minus size={16} color="var(--grey)" aria-label="no" />
        ),
      record: ({ value }) => (value === null ? '' : value ? 'Yes' : 'No'),
    },
    Input: (props) => (
      <Select
        label={props.label}
        error={props.error}
        data={[
          { value: 'true', label: 'Yes' },
          { value: 'false', label: 'No' },
        ]}
        value={props.value === null || props.value === '' ? null : String(props.value)}
        onChange={(v) => props.onChange(v === null ? null : v === 'true')}
        clearable={!props.field.column.required}
      />
    ),
    toForm: (value) => value ?? null,
    operators: ['eq', 'is_null', 'not_null'],
    parseFilter: (text) => /^(true|t|yes|1)$/i.test(text.trim()),
  },
  written('date', 'Date'),
  written('time', 'Time'),
  written('moment', 'Moment'),
  {
    ...written('uuid', 'UUID'),
    draw: {
      list: ({ value }) => <Mono title={textOf(value)}>{textOf(value).slice(0, 8)}</Mono>,
      record: ({ value }) => <Mono>{textOf(value)}</Mono>,
    },
    operators: ['eq', 'neq', 'in', 'is_null', 'not_null'],
  },
  {
    name: 'json',
    label: 'JSON',
    claims: ofKind('json'),
    draw: {
      list: ({ value }) => (
        <Mono>
          <Clipped text={JSON.stringify(value)} />
        </Mono>
      ),
      record: ({ value }) => <Code block>{JSON.stringify(value, null, 2)}</Code>,
    },
    Input: (props) => (
      <JsonInput
        label={props.label}
        error={props.error}
        value={textOf(props.value)}
        onChange={props.onChange}
        autosize
        minRows={3}
        formatOnBlur
      />
    ),
    toForm: (value) =>
      value === null || value === undefined ? '' : JSON.stringify(value, null, 2),
    // The value travels as JSON text. Metadata is typed as it is meant: a sentence is a string.
    fromForm(held, field) {
      const text = textOf(held).trim()
      if (!text) return null
      try {
        JSON.parse(text)
        return text
      } catch {
        if (field.column.schema === 'platform' && field.column.table === 'item_metadata')
          return JSON.stringify(text)
        throw new Error('This is not JSON')
      }
    },
    operators: ['contains', 'is_null', 'not_null'],
  },
  {
    name: 'choice',
    label: 'One of a list',
    claims: (field) => (field.choices ? 20 : 0),
    draw: { list: Choice, record: Choice },
    Input: (props) => (
      <Select
        label={props.label}
        error={props.error}
        data={props.field.choices ?? []}
        value={textOf(props.value) || null}
        onChange={(v) => props.onChange(v ?? '')}
        clearable={!props.field.column.required}
      />
    ),
    fromForm: blankIsNull,
    operators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'not_null'],
  },
  {
    name: 'relation',
    label: 'Relation',
    claims: (field) => (field.relation ? 30 : 0),
    draw: {
      list: ({ value, label }) =>
        label ? (
          <Clipped text={label} />
        ) : (
          <Mono title={textOf(value)}>{textOf(value).slice(0, 8)}</Mono>
        ),
      record: ({ value, label }) => (
        <>
          {label} <Mono>{textOf(value)}</Mono>
        </>
      ),
    },
    Input: RelationInput,
    fromForm: blankIsNull,
    operators: ['eq', 'neq', 'is_null', 'not_null'],
  },
] satisfies FieldType[])
  registerFieldType(type)

/** Every field of a collection, from the two things the reader was given: the catalog and the fields' own metadata. */
export function resolveFields(
  catalog: Catalog,
  schema: string,
  table: string,
  rows: readonly MetadataRow[] = []
): Field[] {
  const said = indexFields(rows)
  const fields = columnsOf(catalog, schema, table).map((column) => {
    const field = {
      name: column.name,
      label: said[column.name]?.label ?? column.name,
      column,
      kind: kindOf(column.type),
      relation: relationOf(catalog, schema, table, column.name),
      choices: choicesOf(catalog, schema, table, column.name),
      system: systemFields.includes(column.name),
      computed: !!column.generated || !!column.identity,
      views: said[column.name]?.views ?? everyView,
      hasViews: !!said[column.name]?.views,
      renderers: said[column.name]?.renderers ?? {},
    }
    return { ...field, type: fieldTypeFor(field) }
  })
  // A collection's own fields come first; the ones every collection is made with follow.
  return [...fields.filter((f) => !f.system), ...fields.filter((f) => f.system)]
}

// ------------------------------------------------------------------------------ renderers

export interface RendererOption {
  name: string
  label: string
  type: 'text' | 'number' | 'icon' | 'colour'
  placeholder?: string
}
export interface Renderer {
  name: string
  label: string
  /** The kinds of value it fits; none means every kind. */
  kinds: Kind[]
  options?: RendererOption[]
  render(props: DrawProps): ReactNode
}
const renderers = new Map<string, Renderer>()
/** Adds a renderer: one of the platform's, or one of the installation's own, from its extensions. */
export const registerRenderer = (renderer: Renderer) => void renderers.set(renderer.name, renderer)
export const renderersFor = (field: Field) =>
  [...renderers.values()].filter((r) => !r.kinds.length || r.kinds.includes(field.kind))
const filled = (template: unknown, value: unknown, fallback: string) =>
  (typeof template === 'string' && template ? template : fallback).replaceAll(
    '{value}',
    textOf(value)
  )
const numbers: Kind[] = ['integer', 'number']

for (const renderer of [
  {
    name: 'text',
    label: 'The text, in full',
    kinds: ['text'],
    render: ({ value }) => textOf(value),
  },
  {
    name: 'truncate',
    label: 'The text, shortened',
    kinds: ['text'],
    options: [{ name: 'length', label: 'Characters to keep', type: 'number', placeholder: '20' }],
    render: ({ value, options }) => (
      <Clipped text={textOf(value)} length={numberOf(options.length) ?? 20} />
    ),
  },
  {
    name: 'paragraph',
    label: 'The text, as it was typed',
    kinds: ['text'],
    render: ({ value }) => <Text style={{ whiteSpace: 'pre-wrap' }}>{textOf(value)}</Text>,
  },
  {
    name: 'number',
    label: 'The number, with its thousands marked',
    kinds: numbers,
    render: ({ value }) => <Mono>{grouped(value)}</Mono>,
  },
  {
    name: 'boolean',
    label: 'Yes or no, in words',
    kinds: ['boolean'],
    render: ({ value }) => (value === null ? '' : value ? 'Yes' : 'No'),
  },
  {
    name: 'moment',
    label: 'The whole moment',
    kinds: ['moment', 'date', 'time'],
    render: ({ value }) => <Mono>{textOf(value)}</Mono>,
  },
  {
    name: 'uuid',
    label: 'The whole uuid',
    kinds: ['uuid'],
    render: ({ value }) => <Mono>{textOf(value)}</Mono>,
  },
  {
    name: 'json',
    label: 'The document, as a document',
    kinds: ['json'],
    render: ({ value }) => <Code block>{JSON.stringify(value, null, 2)}</Code>,
  },
  { name: 'choice', label: 'The value, as the choice it is', kinds: ['text'], render: Choice },
  {
    name: 'link',
    label: 'The text, as a link',
    kinds: ['text'],
    options: [
      {
        name: 'href',
        label: 'The address, with {value} in it',
        type: 'text',
        placeholder: 'https://example.com/{value}',
      },
    ],
    render({ value, options }) {
      const href = filled(options.href, value, '{value}')
      // A value is never trusted to be an address: only http(s) and mailto are links.
      return /^(https?:|mailto:)/i.test(href) ? (
        <Anchor href={href} target="_blank" rel="noreferrer">
          {textOf(value)}
        </Anchor>
      ) : (
        textOf(value)
      )
    },
  },
  {
    name: 'template',
    label: 'The value, in a text of your own',
    kinds: [],
    options: [
      {
        name: 'template',
        label: 'The text, with {value} in it',
        type: 'text',
        placeholder: '» {value}',
      },
    ],
    render: ({ value, options }) => filled(options.template, value, '{value}'),
  },
  {
    name: 'bar',
    label: 'The number, as a bar of a whole',
    kinds: numbers,
    options: [{ name: 'max', label: 'The whole', type: 'number', placeholder: '100' }],
    render: ({ value, options }) => (
      <Progress
        value={((numberOf(value) ?? 0) / (numberOf(options.max) || 100)) * 100}
        title={textOf(value)}
        miw={80}
      />
    ),
  },
  {
    name: 'raw',
    label: 'The value, as PostgreSQL wrote it',
    kinds: [],
    render: ({ value }) => <Mono>{textOf(value)}</Mono>,
  },
] satisfies Renderer[])
  registerRenderer(renderer)

/**
 * A value, drawn where it is. The field's own saying picks the renderer for the situation; one
 * the platform does not hold, or that does not fit the kind of value, draws nothing, and the
 * field's type draws the value its own way.
 */
export function Value({
  field,
  value,
  situation,
  label,
}: {
  field: Field
  value: unknown
  situation: 'list' | 'record' | 'filter'
  label?: string
}) {
  if (value === null || value === undefined)
    return (
      <Text span c="dimmed" className="mono">
        null
      </Text>
    )
  const choice = field.renderers[situation]
  const renderer = choice && renderersFor(field).find((r) => r.name === choice.renderer)
  const props: DrawProps = { value, field, situation, options: choice?.options ?? {}, label }
  return (
    <>
      {renderer
        ? renderer.render(props)
        : field.type.draw[situation === 'list' ? 'list' : 'record'](props)}
    </>
  )
}

// -------------------------------------------------------------------------------- filters

export const operatorWords: Record<Operator, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  starts_with: 'starts with',
  ends_with: 'ends with',
  gt: 'is more than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  in: 'is one of',
  not_in: 'is none of',
  is_null: 'is empty',
  not_null: 'is not empty',
}
/** The value a condition carries, from what was typed: a list for `in`, the type's own reading otherwise. */
export function filterValue(field: Field | undefined, op: Operator, text: string): unknown {
  const parse = (one: string) => field?.type.parseFilter?.(one) ?? one
  if (valueless.includes(op)) return null
  return op === 'in' || op === 'not_in'
    ? text.split(',').map((one) => parse(one.trim()))
    : parse(text)
}

/** The fields of a collection as this reader meets them, and the collection itself. */
export function useFields(schema: string, table: string) {
  const { catalog } = useSession()
  const said = useDb(['fields', schema, table], (db) => fieldMetadata(db, schema, table), !!table)
  const info = tableOf(catalog, schema, table)
  const fields = useMemo(
    () => resolveFields(catalog, schema, table, said.data),
    [catalog, schema, table, said.data]
  )
  return { info, fields, loading: said.isLoading }
}
