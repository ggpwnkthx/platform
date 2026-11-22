import type { Field as FieldInfo } from '../../fields/field.ts'
import { isWide } from '../../fields/edit.ts'
import { Value } from '../../fields/renderers/renderers.tsx'
import { defaultText } from '../../fields/text.ts'
import { shortType } from '../../format.ts'
import { Badge } from '../../ui/bits.tsx'
import { Field } from '../../ui/form.tsx'
import { HiddenIcon, LockIcon } from '../../ui/icons.tsx'
import { isLocked } from '@platform/vocabulary'

/** The fields the owner keeps out of the form, though the reader may reach them. */
export function WithheldFields({ fields }: { fields: FieldInfo[] }) {
  return (
    <div class="field field-wide unreachable">
      <p>
        <HiddenIcon size={16} aria-hidden="true" />
        Not in the record:{' '}
        {fields.map((c, i) => (
          <span key={c.name}>
            {i > 0 && ', '}
            <span class="mono">{c.name}</span>
          </span>
        ))}
        . The owner of this collection keeps these fields out of the form.
      </p>
    </div>
  )
}

/** The fields the database grants the reader no right to reach at all. */
export function UnreachableFields({
  fields,
  creating,
}: {
  fields: FieldInfo[]
  creating: boolean
}) {
  return (
    <div class="field field-wide unreachable">
      <p>
        <HiddenIcon size={16} aria-hidden="true" />
        {creating ? 'You may not set' : 'Hidden from you'}:{' '}
        {fields.map((c, i) => (
          <span key={c.name}>
            {i > 0 && ', '}
            <span class="mono">{c.name}</span>
          </span>
        ))}
        . The database grants your role no {creating ? 'INSERT' : 'SELECT or UPDATE'} on{' '}
        {fields.length === 1 ? 'it' : 'them'}.
      </p>
    </div>
  )
}

/**
 * One field of the record form: its name, what it is, and either the input that changes it or
 * the value it holds. Which of the two is the database's to say first — a column it computes is
 * never written, and a right it withholds is not offered — and the owner's after it.
 */
export function RecordField({
  field,
  creating,
  text,
  error,
  onChange,
  stored,
  storedLabel,
}: {
  field: FieldInfo
  creating: boolean
  /** What the form holds for the field: text, as typed. */
  text: string
  error?: string
  onChange: (text: string) => void
  /** The value the record holds, when there is a record. */
  stored: unknown
  /** The name of the row a relation points at, when the reader may read it. */
  storedLabel?: string | null
}) {
  const { column, computed } = field
  const id = `field-${field.name}`
  // The database computes some columns itself, and the owner of a collection may lock a field:
  // either way it is shown, and never offered as an input.
  const locked = isLocked(field.views)
  const writable = !computed && !locked && (creating ? column.can_insert : column.can_update)
  const reason = computed
    ? column.generated
      ? 'The database computes this column: a generated column is never written.'
      : 'The database numbers this column itself: an identity column is never written.'
    : locked
      ? 'The owner of this collection marked this field read-only.'
      : 'The database gives you no UPDATE on this field.'
  const wide = isWide(field, text)
  const Input = field.type.Input
  return (
    <Field
      id={id}
      label={field.label}
      required={column.required && !column.default}
      wide={wide}
      error={error}
      hint={column.comment ?? undefined}
      aside={
        <span class="field-tags">
          <span class="field-type mono">{shortType(column.type)}</span>
          {!column.can_select && (
            <Badge tone="warning" title="You may write this field but not read it back">
              write-only
            </Badge>
          )}
          {!writable && (
            <Badge title={reason}>
              <LockIcon size={12} aria-hidden="true" /> read-only
            </Badge>
          )}
        </span>
      }
    >
      {!computed && !locked ? (
        <Input
          field={field}
          id={id}
          text={text}
          onChange={onChange}
          disabled={!writable}
          creating={creating}
          wide={wide}
        />
      ) : !column.can_select ? (
        <p class="side-note">
          You may write this field, but you may not read it back: the database grants you no SELECT
          on it.
        </p>
      ) : creating ? (
        <p class="side-note">
          {column.default
            ? `The database writes this field: ${defaultText(column.default)} by default.`
            : 'The database writes this field itself.'}
        </p>
      ) : (
        // A field the reader may not change is drawn, not offered: the record shows what it
        // holds, drawn the way the field says it is drawn.
        <div class="value-readonly">
          <Value value={stored} field={field} situation="record" label={storedLabel} />
        </div>
      )}
    </Field>
  )
}
