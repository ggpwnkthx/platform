import clsx from 'clsx'
import type { Kind, Operator } from '@platform/data'
import { moment } from '../format.ts'
import { TextArea } from '../ui/form.tsx'
import { CheckIcon, CloseIcon } from '../ui/icons.tsx'
import { ChoiceInput, FilterChoice, FilterLine, lineInput } from './inputs.tsx'
import { metadataValue } from '../metadata/value.tsx'
import { RelationPicker } from './relation.tsx'
import {
  anyNumber,
  choiceTone,
  defaultText,
  grouped,
  readsLong,
  textOf,
  wholeNumber,
} from './text.ts'
import type { Draw, FieldFacts, FieldType, Parsed } from './types.ts'

/**
 * The field types the platform holds: one for every kind of value the database told it of, one
 * for a value chosen from a list and one for a value that points at another row.
 *
 * Each says the whole of what the interface does with such a field. A page that shows fields
 * holds no list of kinds: a kind the platform does not know yet is one more entry here, and
 * a type of the installation's own is one more `registerFieldType`.
 */

/** The weights the platform's own types claim a column with. */
const byKind = 10
const byChoices = 20
const byRelation = 30

/** Claims the columns that hold one of these kinds of value. */
const ofKind =
  (...kinds: Kind[]) =>
  (facts: FieldFacts): number =>
    kinds.includes(facts.kind) ? byKind : 0

/** The operators of a value that is compared: before and after, more and less. */
const ordered: Operator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'not_null']

/** The operators of a value that is only ever itself. */
const plain: Operator[] = ['eq', 'neq', 'contains', 'is_null', 'not_null']

/** A line of text in the mono face, as the database wrote it. */
const mono: Draw = ({ value }) => <span class="mono">{textOf(value)}</span>

/** Text clipped to the width of its column, with the whole of it in a hint. */
const clipped: Draw = ({ value }) => (
  <span class="clip" title={textOf(value)}>
    {textOf(value)}
  </span>
)

/** Text in full, wrapped where it falls. */
const wrapped: Draw = ({ value }) => <span class="value-text">{textOf(value)}</span>

/** What was typed, as a number the database will read — or why it is not one. */
const numberFrom =
  (shape: RegExp, error: string) =>
  (text: string): Parsed =>
    shape.test(text.trim()) ? { value: text.trim() } : { error }

/** A line of prose: the one input that is not set in the mono face. */
const ProseLine = lineInput({ mono: false })

const text: FieldType = {
  name: 'text',
  label: 'Text',
  claims: ofKind('text'),
  draw: { list: clipped, record: wrapped },
  // Prose is kept as it was typed: a space at the end of it is the writer's own.
  fromText: (typed) => ({ value: typed }),
  wide: (field, typed) => readsLong(field.name) || typed.length > 60,
  Input: (props) =>
    props.wide ? (
      <TextArea
        id={props.id}
        rows={4}
        value={props.text}
        disabled={props.disabled}
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
    ) : (
      <ProseLine {...props} />
    ),
  filter: {
    operators: ['contains', 'eq', 'neq', 'starts_with', 'ends_with', 'in', 'is_null', 'not_null'],
  },
}

const integer: FieldType = {
  name: 'integer',
  label: 'Whole number',
  claims: ofKind('integer'),
  numeric: true,
  draw: {
    list: ({ value }) => <span class="mono cell-number">{textOf(value)}</span>,
    record: ({ value }) => <span class="mono cell-number value-number">{grouped(value)}</span>,
  },
  fromText: numberFrom(wholeNumber, 'A whole number'),
  Input: lineInput({ inputMode: 'numeric' }),
  filter: { operators: ordered },
}

const number: FieldType = {
  ...integer,
  name: 'number',
  label: 'Number',
  claims: ofKind('number'),
  fromText: numberFrom(anyNumber, 'A number'),
  Input: lineInput({ inputMode: 'decimal' }),
}

const boolean: FieldType = {
  name: 'boolean',
  label: 'Yes or no',
  claims: ofKind('boolean'),
  draw: {
    list: ({ value }) =>
      value ? (
        <span class="cell-bool is-true">
          <CheckIcon size={15} aria-hidden="true" />
          <span class="sr-only">true</span>
        </span>
      ) : (
        <span class="cell-bool">
          <CloseIcon size={15} aria-hidden="true" />
          <span class="sr-only">false</span>
        </span>
      ),
    record: ({ value }) => (
      <span class={clsx('value-boolean', Boolean(value) && 'is-true')}>{value ? 'Yes' : 'No'}</span>
    ),
  },
  fromText: (typed) => ({ value: typed === 'true' }),
  Input: (props) => (
    <ChoiceInput
      {...props}
      empty={
        props.creating && props.field.column.default
          ? `${defaultText(props.field.column.default)} (default)`
          : 'null'
      }
      options={['true', 'false']}
    />
  ),
  filter: {
    operators: ['eq', 'is_null', 'not_null'],
    initial: () => 'true',
    parse: (typed) => typed === 'true',
    Input: (props) => <FilterChoice {...props} options={['true', 'false']} />,
  },
}

const date: FieldType = {
  name: 'date',
  label: 'Date',
  claims: ofKind('date'),
  draw: { list: mono, record: mono },
  Input: lineInput({ type: 'date' }),
  filter: { operators: ordered },
}

const time: FieldType = {
  ...date,
  name: 'time',
  label: 'Time of day',
  claims: ofKind('time'),
  Input: lineInput({ type: 'time' }),
}

const timestamp: FieldType = {
  name: 'moment',
  label: 'Moment',
  claims: ofKind('moment'),
  draw: {
    // To the minute in the grid; the whole moment, as it was written, in the record.
    list: ({ value }) => <span class="mono">{moment(value)}</span>,
    record: ({ value }) => <span class="mono value-moment">{textOf(value)}</span>,
  },
  Input: lineInput({ placeholder: 'YYYY-MM-DD HH:MM:SS+00' }),
  filter: { operators: ordered },
}

const uuid: FieldType = {
  name: 'uuid',
  label: 'UUID',
  claims: ofKind('uuid'),
  draw: {
    list: ({ value }) => (
      <span class="mono" title={String(value)}>
        {String(value).slice(0, 8)}
      </span>
    ),
    record: ({ value }) => <span class="mono value-uuid">{textOf(value)}</span>,
  },
  Input: lineInput(),
  filter: { operators: plain },
}

const json: FieldType = {
  name: 'json',
  label: 'JSON',
  claims: ofKind('json'),
  draw: {
    list: ({ value }) => <span class="mono cell-json clip">{textOf(value)}</span>,
    record: ({ value }) => <pre class="mono value-json">{JSON.stringify(value, null, 2)}</pre>,
  },
  toText: (value) => JSON.stringify(value, null, 2),
  fromText: (typed) => {
    try {
      return { value: JSON.parse(typed) }
    } catch {
      return { error: 'Not valid JSON' }
    }
  },
  wide: () => true,
  Input: (props) => (
    <TextArea
      id={props.id}
      mono
      rows={6}
      value={props.text}
      disabled={props.disabled}
      onInput={(e) => props.onChange(e.currentTarget.value)}
    />
  ),
  filter: { operators: plain },
}

/** A value chosen from a list: a column a CHECK holds to a few values. */
const choice: FieldType = {
  name: 'choice',
  label: 'Choice',
  claims: (facts) => (facts.choices ? byChoices : 0),
  draw: {
    // A chip in the grid, coloured by what the word means; the choice itself in the record.
    list: (drawn) =>
      typeof drawn.value === 'string' ? (
        <span class={clsx('choice', `choice-${choiceTone(drawn.value)}`)}>{drawn.value}</span>
      ) : (
        clipped(drawn)
      ),
    record: (drawn) =>
      typeof drawn.value === 'string' ? (
        <span class="value-choice">{drawn.value}</span>
      ) : (
        wrapped(drawn)
      ),
  },
  fromText: (typed, field) => ({ value: field.kind === 'text' ? typed : typed.trim() }),
  Input: (props) => {
    const { column } = props.field
    return (
      <ChoiceInput
        {...props}
        // A required field that is set offers no way back to nothing.
        empty={
          column.required && props.text
            ? undefined
            : column.default && props.creating
              ? `${defaultText(column.default)} (default)`
              : '—'
        }
        options={props.field.choices ?? []}
      />
    )
  },
  filter: {
    operators: ['eq', 'neq', 'in', 'not_in', 'is_null', 'not_null'],
    initial: (field) => field.choices?.[0] ?? '',
    // One of the list is chosen; several of it are typed.
    Input: (props) =>
      props.op === 'eq' || props.op === 'neq' ? (
        <FilterChoice {...props} options={props.field.choices ?? []} />
      ) : (
        <FilterLine {...props} />
      ),
  },
}

/** A value that points at a row of another collection: a foreign key. */
const relation: FieldType = {
  name: 'relation',
  label: 'Relation',
  claims: (facts) => (facts.relation ? byRelation : 0),
  draw: {
    // The name of the row it points at; the id stands in where the reader may not read it.
    list: ({ value, label }) => (
      <span class="cell-relation" title={String(value)}>
        <span class="clip">{label || <span class="mono">{String(value).slice(0, 8)}…</span>}</span>
      </span>
    ),
    record: ({ value, label }) => (
      <span class="value-relation">
        <span class="value-relation-name">
          {label || <span class="mono">{String(value).slice(0, 8)}…</span>}
        </span>
        <small class="mono value-relation-id">{String(value)}</small>
      </span>
    ),
  },
  Input: (props) => (
    <RelationPicker
      id={props.id}
      relation={props.field.relation!}
      value={props.text}
      onChange={props.onChange}
      disabled={props.disabled}
    />
  ),
  filter: { operators: plain },
}

/** A value of a type the platform has no drawing for: an extension's, or the database's own. */
const other: FieldType = {
  name: 'other',
  label: 'Other',
  // The type of last resort: it claims every column, below every other type.
  claims: () => 1,
  draw: { list: clipped, record: wrapped },
  Input: lineInput(),
  filter: { operators: plain },
}

/** The field types the platform holds. */
export const platformFieldTypes: FieldType[] = [
  text,
  integer,
  number,
  boolean,
  date,
  time,
  timestamp,
  uuid,
  json,
  choice,
  relation,
  other,
  // The platform's own collections have fields of their own.
  metadataValue,
]
