import type { FunctionComponent, JSX } from 'preact'
import { Input, Select } from '../ui/form.tsx'
import { defaultText } from './text.ts'
import type { FilterInputProps, InputProps } from './types.ts'

/** The inputs the field types share: a line, and a choice among a few. */

/** What an empty input says: the default the database will write, or what the type expects. */
export function placeholderOf({ field, creating }: InputProps, otherwise?: string) {
  const fallback = field.column.default
  return creating && fallback ? `Default: ${defaultText(fallback)}` : otherwise
}

/** A one-line input: text as typed, with whatever the type knows of how it is written. */
export function lineInput(
  how: {
    type?: 'date' | 'time'
    inputMode?: JSX.HTMLAttributes<HTMLInputElement>['inputMode']
    /** What the input shows while it is empty and the database has no default to write. */
    placeholder?: string
    /** Set in the mono face, as everything that is not prose is. */
    mono?: boolean
  } = {}
): FunctionComponent<InputProps> {
  return function LineInput(props) {
    return (
      <Input
        id={props.id}
        type={how.type ?? 'text'}
        inputMode={how.inputMode}
        mono={how.mono ?? true}
        value={props.text}
        disabled={props.disabled}
        placeholder={placeholderOf(props, how.placeholder)}
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
    )
  }
}

/** A choice among a few values, with a first option for the value that is not set. */
export function ChoiceInput({
  id,
  text,
  onChange,
  disabled,
  empty,
  options,
}: Pick<InputProps, 'id' | 'text' | 'onChange' | 'disabled'> & {
  /** What the unset option reads; without one, there is no unset option. */
  empty?: string
  options: readonly string[]
}) {
  return (
    <Select
      id={id}
      value={text}
      disabled={disabled}
      onChange={(e) => onChange(e.currentTarget.value)}
    >
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </Select>
  )
}

/** The value of a condition, typed on a line: one value, or several between commas. */
export function FilterLine({ op, text, onChange }: FilterInputProps) {
  return (
    <Input
      value={text}
      onInput={(e) => onChange(e.currentTarget.value)}
      placeholder={op === 'in' || op === 'not_in' ? 'a, b, c' : 'Value'}
      aria-label="Value"
    />
  )
}

/** The value of a condition, chosen from a few. */
export function FilterChoice({
  text,
  onChange,
  options,
}: Pick<FilterInputProps, 'text' | 'onChange'> & { options: readonly string[] }) {
  return (
    <Select value={text} onChange={(e) => onChange(e.currentTarget.value)} aria-label="Value">
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </Select>
  )
}
