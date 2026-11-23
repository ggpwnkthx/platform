import { NumberInput, Select, Textarea, TextInput } from '@mantine/core'
import type { Kind, Operator } from '@platform/core'
import { Check, Minus } from 'lucide-react'
import type { Field, FieldType, InputProps } from './types.ts'
import { Clipped, grouped, minute, Mono, numberOf, Paragraph, textOf } from './values.tsx'

const line = (props: InputProps, more: object = {}) => (
  <TextInput
    label={props.label}
    error={props.error}
    value={textOf(props.value)}
    onChange={(e) => props.onChange(e.currentTarget.value)}
    {...more}
  />
)
export const blankIsNull = (held: unknown) => (held === '' || held === undefined ? null : held)
export const comparable: Operator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null']
export const ofKind = (kind: Kind) => (field: Omit<Field, 'type'>) => (field.kind === kind ? 10 : 0)
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
/** A type PostgreSQL writes itself, with no meaning of its own beyond the kind it holds. */
export const written = (kind: Kind, label: string): FieldType => ({
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

/** The types every collection may hold: text, numbers, yes or no, moments and documents. */
export const basicTypes: FieldType[] = [
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
      record: ({ value }) => <Paragraph value={value} />,
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
]
