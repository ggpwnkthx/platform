import clsx from 'clsx'
import { ChoiceInput, FilterChoice, FilterLine, lineInput } from '../inputs.tsx'
import { RelationPicker } from '../relation.tsx'
import { choiceTone, defaultText } from '../text.ts'
import type { FieldType } from '../field.ts'
import { byChoices, byRelation, clipped, plain, wrapped } from './shared.tsx'

/** A value chosen from a list: a column a CHECK holds to a few values. */
export const choice: FieldType = {
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
export const relation: FieldType = {
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
export const other: FieldType = {
  name: 'other',
  label: 'Other',
  // The type of last resort: it claims every column, below every other type.
  claims: () => 1,
  draw: { list: clipped, record: wrapped },
  Input: lineInput(),
  filter: { operators: plain },
}
