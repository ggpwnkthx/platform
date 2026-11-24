import type { Kind, Operator } from '@platform/core'
import { Check, Minus } from 'lucide-react'
import { NullableBooleanInput, NumberInput, SelectInput, TextInput } from 'react-admin'
import { iconSize } from '../kit/marks.tsx'
import { registerFieldType } from './registry.ts'
import type { Field, FieldType, InputProps } from './types.ts'
import { Choice, Clipped, Document, grouped, minute, Mono, Paragraph, textOf } from './values.tsx'

/** The field types the platform ships: one for each kind of column, and three for relations. */
const blankIsNull = (held: unknown) => (held === '' || held === undefined ? null : held)
const comparable: Operator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null']
const ofKind = (kind: Kind) => (field: Omit<Field, 'type'>) => (field.kind === kind ? 10 : 0)
const long = (name: string) =>
  /(^|_)(body|notes?|description|content|summary|text|wording)$/.test(name)
const Line = ({ source, label }: InputProps, more: object = {}) => (
  <TextInput source={source} label={label} helperText={false} {...more} />
)
/** The kinds PostgreSQL writes as text of its own shape: a line, and the browser's picker where it has one. */
const writtenAs: Partial<Record<Kind, object>> = {
  date: { type: 'date', InputLabelProps: { shrink: true } },
  time: { type: 'time', InputLabelProps: { shrink: true } },
  moment: { placeholder: '2026-01-31 09:30:00+00' },
}
const WrittenInput = (props: InputProps) =>
  Line(props, { className: 'mono', ...writtenAs[props.field.kind] })
const written = (kind: Kind, label: string): FieldType => ({
  name: kind,
  label,
  claims: ofKind(kind),
  draw: ({ value, situation }) => (
    <Mono>{situation === 'list' ? minute(value) : textOf(value)}</Mono>
  ),
  Input: WrittenInput,
  toColumn: blankIsNull,
  operators: comparable,
})
const NumberField = ({ source, label }: InputProps) => (
  <NumberInput source={source} label={label} helperText={false} />
)
const number = (kind: 'integer' | 'number', label: string): FieldType => ({
  name: kind,
  label,
  claims: ofKind(kind),
  numeric: true,
  draw: ({ value, situation }) => (
    <Mono>{situation === 'list' ? textOf(value) : grouped(value)}</Mono>
  ),
  Input: NumberField,
  toColumn: blankIsNull,
  operators: comparable,
})
const types: FieldType[] = [
  {
    name: 'other',
    label: 'Any value',
    claims: () => 1,
    draw: ({ value, situation }) => (
      <Mono>{situation === 'list' ? <Clipped text={textOf(value)} /> : textOf(value)}</Mono>
    ),
    Input: (props) => Line(props, { className: 'mono' }),
    toColumn: blankIsNull,
    operators: ['contains', 'eq', 'neq', 'is_null', 'not_null'],
  },
  {
    name: 'text',
    label: 'Text',
    claims: ofKind('text'),
    draw: ({ value, situation }) =>
      situation === 'list' ? <Clipped text={textOf(value)} /> : <Paragraph value={value} />,
    Input: (props) =>
      Line(props, long(props.field.name) && !props.op ? { multiline: true, minRows: 3 } : {}),
    toColumn: blankIsNull,
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
  number('integer', 'Whole number'),
  number('number', 'Number'),
  {
    name: 'boolean',
    label: 'Yes or no',
    claims: ofKind('boolean'),
    draw: ({ value, situation }) =>
      situation === 'record' ? (
        value ? (
          'Yes'
        ) : (
          'No'
        )
      ) : value ? (
        <Check size={iconSize} aria-label="yes" />
      ) : (
        <Minus size={iconSize} aria-label="no" />
      ),
    Input: ({ source, label }) => (
      <NullableBooleanInput source={source} label={label} helperText={false} />
    ),
    operators: ['eq', 'is_null', 'not_null'],
  },
  written('date', 'Date'),
  written('time', 'Time'),
  written('moment', 'Moment'),
  {
    ...written('uuid', 'UUID'),
    draw: ({ value, situation }) => (
      <Mono title={textOf(value)}>
        {situation === 'list' ? textOf(value).slice(0, 8) : textOf(value)}
      </Mono>
    ),
    operators: ['eq', 'neq', 'in', 'is_null', 'not_null'],
  },
  {
    name: 'json',
    label: 'Document',
    claims: ofKind('json'),
    draw: ({ value, situation }) =>
      situation === 'list' ? (
        <Mono>
          <Clipped text={textOf(value)} />
        </Mono>
      ) : (
        <Document value={value} />
      ),
    Input: ({ source, label }) => (
      <TextInput
        source={source}
        label={label}
        helperText={false}
        multiline
        minRows={3}
        className="mono"
        format={(value) =>
          typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)
        }
        validate={(value) => {
          try {
            if (typeof value === 'string' && value.trim()) JSON.parse(value)
          } catch {
            return 'This is not a JSON document.'
          }
        }}
      />
    ),
    toColumn: (held) =>
      typeof held === 'string'
        ? held.trim()
          ? JSON.stringify(JSON.parse(held))
          : null
        : held == null
          ? null
          : JSON.stringify(held),
    operators: ['contains', 'is_null', 'not_null'],
  },
  {
    name: 'choice',
    label: 'One of a list',
    claims: (field) => (field.choices ? 20 : 0),
    draw: Choice,
    Input: ({ field, source, label }) => (
      <SelectInput
        source={source}
        label={label}
        helperText={false}
        choices={field.choices!.map((id) => ({ id, name: id }))}
      />
    ),
    toColumn: blankIsNull,
    operators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'not_null'],
  },
]
for (const type of types) registerFieldType(type)
