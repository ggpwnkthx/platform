/**
 * The pieces of the pages of a workspace.
 */

import type { Crumb } from '../context'
import type { FieldMetadata, Me } from '../../domains/data'
import { displayOf, formValueOf, inputKindOf } from '../../domains/data'
import JsonInput from '../islands/json-input'
import { Tabs } from './page'

/** The name of a workspace, as the registry of the data service holds it. */
export function workspaceName(me: Me | null, id: string): string {
  return me?.workspace?.displayName ?? me?.workspace?.slug ?? id
}

/** The path of a workspace. */
export function workspacePath(id: string): string {
  return `/workspaces/${encodeURIComponent(id)}`
}

/** The path of a collection of a workspace. */
export function collectionPath(workspace: string, collection: string): string {
  return `${workspacePath(workspace)}/collections/${encodeURIComponent(collection)}`
}

/** The path of a record. */
export function recordPath(workspace: string, collection: string, id: string): string {
  return `${collectionPath(workspace, collection)}/records/${encodeURIComponent(id)}`
}

/** The breadcrumbs of a page of a workspace. */
export function workspaceCrumbs(id: string, me: Me | null, ...rest: Crumb[]): Crumb[] {
  return [
    { label: 'Workspaces', href: '/workspaces' },
    { label: workspaceName(me, id), href: workspacePath(id) },
    ...rest,
  ]
}

/** The tabs of a workspace. */
export function WorkspaceTabs(props: { id: string; current: 'collections' | 'model' | 'audit' }) {
  const base = workspacePath(props.id)
  return (
    <Tabs
      items={[
        { href: base, label: 'Collections', current: props.current === 'collections' },
        { href: `${base}/model`, label: 'Data model', current: props.current === 'model' },
        { href: `${base}/audit`, label: 'Audit', current: props.current === 'audit' },
      ]}
    />
  )
}

/** The label of a field. */
export function labelOf(field: { name: string; label?: string }): string {
  return field.label ?? field.name
}

/** The control of a field of a record. */
export function FieldInput(props: {
  field: FieldMetadata
  value: string
  problem?: string
  creating: boolean
}) {
  const { field } = props
  const id = `field-${field.name}`
  const kind = inputKindOf(field)
  const required = props.creating && field.required
  const invalid = props.problem ? 'true' : undefined
  let control: unknown
  switch (kind) {
    case 'textarea':
      control = (
        <textarea id={id} name={field.name} rows={6} required={required} aria-invalid={invalid}>
          {props.value}
        </textarea>
      )
      break
    case 'select':
      control = (
        <select id={id} name={field.name} required={required} aria-invalid={invalid}>
          {!field.required || field.nullable ? <option value="">—</option> : null}
          {(field.enum ?? []).map((option) => (
            <option value={option} selected={option === props.value}>
              {option}
            </option>
          ))}
        </select>
      )
      break
    case 'boolean':
      control = (
        <select id={id} name={field.name} required={required} aria-invalid={invalid}>
          <option value="">—</option>
          <option value="true" selected={props.value === 'true'}>
            yes
          </option>
          <option value="false" selected={props.value === 'false'}>
            no
          </option>
        </select>
      )
      break
    case 'integer':
      control = (
        <input
          id={id}
          name={field.name}
          type="number"
          step="1"
          min={field.minimum}
          max={field.maximum}
          value={props.value}
          required={required}
          aria-invalid={invalid}
        />
      )
      break
    case 'decimal':
      control = (
        <input
          id={id}
          name={field.name}
          inputmode="decimal"
          pattern="-?\d+(\.\d+)?"
          value={props.value}
          required={required}
          aria-invalid={invalid}
        />
      )
      break
    case 'timestamp':
      control = (
        <input
          id={id}
          name={field.name}
          type="datetime-local"
          step="1"
          value={props.value}
          required={required}
          aria-invalid={invalid}
        />
      )
      break
    case 'json':
      control = <JsonInput id={id} name={field.name} initial={props.value} required={required} />
      break
    case 'uuid':
      control = (
        <input
          id={id}
          name={field.name}
          class="mono"
          spellcheck={false}
          placeholder="00000000-0000-4000-8000-000000000000"
          value={props.value}
          required={required}
          aria-invalid={invalid}
        />
      )
      break
    default:
      control = (
        <input
          id={id}
          name={field.name}
          value={props.value}
          maxlength={field.maxLength}
          minlength={field.minLength}
          required={required}
          aria-invalid={invalid}
        />
      )
  }
  const hints = [
    field.type,
    field.required ? 'required' : null,
    field.nullable ? null : 'never empty',
    field.maxLength ? `at most ${field.maxLength} characters` : null,
    kind === 'timestamp' ? 'UTC' : null,
  ].filter(Boolean)
  return (
    <label class={`field ${kind === 'textarea' || kind === 'json' ? 'wide' : ''}`} for={id}>
      <span>{labelOf(field)}</span>
      {control}
      {props.problem ? <span class="problem">{props.problem}</span> : null}
      <span class="hint">
        {field.description ? `${field.description} · ` : ''}
        {hints.join(' · ')}
      </span>
    </label>
  )
}

/** The form text of a value of a record. */
export function textOf(field: FieldMetadata, value: unknown): string {
  return formValueOf(field, value)
}

/** A value of a record, as a page shows it. */
export function Value(props: { value: unknown; long?: boolean }) {
  const { value } = props
  if (value === null || value === undefined) return <span class="muted">—</span>
  if (typeof value === 'object') {
    return <pre>{JSON.stringify(value, null, 2)}</pre>
  }
  if (props.long && typeof value === 'string' && value.length > 120) {
    return <div style="white-space: pre-wrap">{value}</div>
  }
  return <span>{displayOf(value, props.long ? 10_000 : 80)}</span>
}
