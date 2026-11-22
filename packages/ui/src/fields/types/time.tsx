import { TextArea } from '../../ui/form.tsx'
import { moment } from '../../format.ts'
import { lineInput } from '../inputs.tsx'
import { textOf } from '../text.ts'
import type { FieldType } from '../field.ts'
import { mono, ofKind, ordered, plain } from './shared.tsx'

/** A date. */
export const date: FieldType = {
  name: 'date',
  label: 'Date',
  claims: ofKind('date'),
  draw: { list: mono, record: mono },
  Input: lineInput({ type: 'date' }),
  filter: { operators: ordered },
}

/** A time of day. */
export const time: FieldType = {
  ...date,
  name: 'time',
  label: 'Time of day',
  claims: ofKind('time'),
  Input: lineInput({ type: 'time' }),
}

/** A moment: a date and a time of day, as the database wrote it. */
export const timestamp: FieldType = {
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

/** A uuid. */
export const uuid: FieldType = {
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

/** A document, as the database wrote it. */
export const json: FieldType = {
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
