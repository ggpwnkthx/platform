import type { RefObject } from 'preact'
import type { Field as FieldInfo } from '../../fields/field.ts'
import { Loading, Notice, Statement } from '../../ui/bits.tsx'
import { Action } from '../../ui/button.tsx'
import { CheckIcon, TrashIcon } from '../../ui/icons.tsx'
import { describe } from '../../session.tsx'
import { RecordField, UnreachableFields, WithheldFields } from './fields.tsx'
import { boundCount } from './helpers.ts'

/** What the reader does with a record: saves it, or deletes it. */
export function RecordActions({
  canDelete,
  creating,
  dirty,
  errors,
  formRef,
  present,
  saving,
  setConfirming,
}: {
  canDelete: boolean
  creating: boolean
  dirty: boolean
  errors: Record<string, string>
  formRef: RefObject<HTMLFormElement>
  /** A record that did not load offers nothing to save or delete. */
  present: boolean
  saving: boolean
  setConfirming: (on: boolean) => void
}) {
  return (
    <>
      {canDelete && (
        <Action
          tone="danger"
          label="Delete record"
          icon={<TrashIcon size={20} />}
          onClick={() => setConfirming(true)}
        />
      )}
      {present && (
        <Action
          label={creating ? 'Create record' : 'Save changes (Ctrl+S)'}
          icon={<CheckIcon size={22} />}
          busy={saving}
          disabled={(!dirty && !creating) || Object.keys(errors).length > 0}
          onClick={() => formRef.current?.requestSubmit()}
        />
      )}
    </>
  )
}

/** The form of the record: the fields the reader may reach, and the statement that saves it. */
function RecordForm({
  creating,
  errors,
  fields,
  formRef,
  labels,
  onChange,
  original,
  save,
  statement,
  textOf,
  unreachable,
  values,
  version,
  withheld,
}: {
  creating: boolean
  errors: Record<string, string>
  fields: FieldInfo[]
  formRef: RefObject<HTMLFormElement>
  /** The name of the row a relation points at, when the reader may read it. */
  labels: Record<string, Record<string, string>>
  onChange: (name: string, text: string) => void
  original: Record<string, unknown> | null
  save: (event?: Event) => void
  statement: string | null
  textOf: (field: FieldInfo) => string
  unreachable: FieldInfo[]
  values: Record<string, unknown>
  version: number | undefined
  withheld: FieldInfo[]
}) {
  return (
    <form ref={formRef} class="form" onSubmit={save}>
      {fields.map((field) => (
        <RecordField
          key={field.name}
          field={field}
          creating={creating}
          text={textOf(field)}
          error={errors[field.name]}
          onChange={(text) => onChange(field.name, text)}
          stored={original?.[field.name]}
          storedLabel={labels[field.name]?.[String(original?.[field.name])]}
        />
      ))}
      {withheld.length > 0 && <WithheldFields fields={withheld} />}
      {unreachable.length > 0 && <UnreachableFields fields={unreachable} creating={creating} />}
      {statement && (
        <div class="field field-wide">
          <Statement
            sql={statement}
            label={`Saving runs this as you, with ${boundCount(values, creating, version)} bound values`}
          />
        </div>
      )}
      <button type="submit" hidden />
    </form>
  )
}

/** What the database said when it would not read the record. */
function RecordProblem({ problem }: { problem: unknown }) {
  return (
    <Notice tone="danger" title={describe(problem).title}>
      {describe(problem).detail ?? 'The database could not read this record.'}
    </Notice>
  )
}

/** A record that does not reach this reader. */
function NoSuchRecord() {
  return (
    <Notice tone="warning" title="No such record reaches you">
      It does not exist, or a row policy keeps it from your role.
    </Notice>
  )
}

/**
 * What the page shows of the record: the problem the database gave, the wait for the record,
 * the refusal of a record that does not reach this reader, or the form itself.
 */
export function RecordBody({
  form,
  record,
}: {
  /** What the form holds, and what it saves. */
  form: {
    errors: Record<string, string>
    fields: FieldInfo[]
    formRef: RefObject<HTMLFormElement>
    onChange: (name: string, text: string) => void
    save: (event?: Event) => void
    statement: string | null
    textOf: (field: FieldInfo) => string
    unreachable: FieldInfo[]
    values: Record<string, unknown>
    version: number | undefined
    withheld: FieldInfo[]
  }
  /** What the record is, and what the database said of it. */
  record: {
    creating: boolean
    hasData: boolean
    labels: Record<string, Record<string, string>>
    original: Record<string, unknown> | null
    problem: unknown
    wanted: boolean
  }
}) {
  if (record.problem) return <RecordProblem problem={record.problem} />
  if (!record.hasData) return <Loading />
  if (!record.creating && record.wanted && record.original === null) return <NoSuchRecord />
  return (
    <RecordForm
      creating={record.creating}
      errors={form.errors}
      fields={form.fields}
      formRef={form.formRef}
      labels={record.labels}
      onChange={form.onChange}
      original={record.original}
      save={form.save}
      statement={form.statement}
      textOf={form.textOf}
      unreachable={form.unreachable}
      values={form.values}
      version={form.version}
      withheld={form.withheld}
    />
  )
}
