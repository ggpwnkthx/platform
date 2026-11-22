import clsx from 'clsx'
import { TextArea } from '../../ui/form.tsx'
import { CheckIcon, CloseIcon } from '../../ui/icons.tsx'
import { ChoiceInput, FilterChoice, lineInput } from '../inputs.tsx'
import { anyNumber, defaultText, grouped, readsLong, wholeNumber } from '../text.ts'
import type { FieldType } from '../field.ts'
import { clipped, numberFrom, ofKind, ordered, ProseLine, wrapped } from './shared.tsx'

/** Text: the kind of value most columns hold, and the one a person writes. */
export const text: FieldType = {
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

/** A whole number. */
export const integer: FieldType = {
  name: 'integer',
  label: 'Whole number',
  claims: ofKind('integer'),
  numeric: true,
  draw: {
    list: ({ value }) => <span class="mono cell-number">{String(value ?? '')}</span>,
    record: ({ value }) => <span class="mono cell-number value-number">{grouped(value)}</span>,
  },
  fromText: numberFrom(wholeNumber, 'A whole number'),
  Input: lineInput({ inputMode: 'numeric' }),
  filter: { operators: ordered },
}

/** A number: a whole number that is not whole. */
export const number: FieldType = {
  ...integer,
  name: 'number',
  label: 'Number',
  claims: ofKind('number'),
  fromText: numberFrom(anyNumber, 'A number'),
  Input: lineInput({ inputMode: 'decimal' }),
}

/** Yes or no. */
export const boolean: FieldType = {
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
