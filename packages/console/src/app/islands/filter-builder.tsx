/**
 * The filter of a list, built from rows or written as json.
 *
 * A row is a field, an operator and a value; the rows are joined with
 * `_and` into the json filter of the data service. A filter that the
 * rows cannot express — an `_or`, a `_not`, a nesting — is written as
 * json, and the builder says so instead of losing it.
 *
 * The builder writes one field of the form, `filter`: the page reads the
 * json, whichever way it was made.
 */

import { useState } from 'hono/jsx'

interface FilterField {
  readonly name: string
  readonly label: string
  readonly type: string
  readonly enum?: readonly string[]
}

interface Row {
  field: string
  op: string
  value: string
}

const OPERATORS: readonly { op: string; label: string }[] = [
  { op: '_eq', label: 'is' },
  { op: '_neq', label: 'is not' },
  { op: '_gt', label: '>' },
  { op: '_gte', label: '≥' },
  { op: '_lt', label: '<' },
  { op: '_lte', label: '≤' },
  { op: '_in', label: 'is one of' },
  { op: '_nin', label: 'is none of' },
  { op: '_is_null', label: 'is empty' },
]

/** The value of a row, in the type of its field. */
function typed(field: FilterField | undefined, op: string, text: string): unknown {
  if (op === '_is_null') return text !== 'false'
  if (op === '_in' || op === '_nin') {
    return text
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => typed(field, '_eq', part))
  }
  if (field?.type === 'integer' && /^-?\d+$/.test(text.trim())) return Number(text.trim())
  if (field?.type === 'boolean') return text === 'true'
  return text
}

/** The rows of a filter, when the rows can express it. */
function rowsOf(text: string): Row[] | null {
  if (!text.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const object = parsed as Record<string, unknown>
  const predicates = Array.isArray(object._and) ? object._and : [object]
  if (Array.isArray(object._and) && Object.keys(object).length !== 1) return null
  const rows: Row[] = []
  for (const predicate of predicates) {
    if (typeof predicate !== 'object' || predicate === null) return null
    const entries = Object.entries(predicate as Record<string, unknown>)
    if (entries.length !== 1) return null
    const [field, condition] = entries[0]!
    if (field.startsWith('_') || typeof condition !== 'object' || condition === null) return null
    const operations = Object.entries(condition as Record<string, unknown>)
    if (operations.length !== 1) return null
    const [op, value] = operations[0]!
    if (!OPERATORS.some((entry) => entry.op === op)) return null
    rows.push({
      field,
      op,
      value: Array.isArray(value) ? value.join(', ') : String(value),
    })
  }
  return rows
}

/** The json of the rows. */
function jsonOf(rows: readonly Row[], fields: readonly FilterField[]): string {
  const predicates = rows
    .filter((row) => row.field && (row.op === '_is_null' || row.value.trim() !== ''))
    .map((row) => ({
      [row.field]: {
        [row.op]: typed(
          fields.find((field) => field.name === row.field),
          row.op,
          row.value
        ),
      },
    }))
  if (predicates.length === 0) return ''
  return JSON.stringify(predicates.length === 1 ? predicates[0] : { _and: predicates })
}

export default function FilterBuilder(props: {
  fields: readonly FilterField[]
  initial: string
  name: string
}) {
  const parsed = rowsOf(props.initial)
  const [mode, setMode] = useState<'rows' | 'json'>(parsed === null ? 'json' : 'rows')
  const [rows, setRows] = useState<Row[]>(parsed ?? [])
  const [text, setText] = useState(props.initial)

  const update = (index: number, change: Partial<Row>) =>
    setRows(rows.map((row, at) => (at === index ? { ...row, ...change } : row)))

  if (mode === 'json') {
    return (
      <div class="stack" style="gap: 0.4rem">
        <textarea
          name={props.name}
          class="code"
          rows={3}
          spellcheck={false}
          placeholder='{"status": {"_eq": "draft"}}'
          onInput={(event: Event) => setText((event.target as HTMLTextAreaElement).value)}
        >
          {text}
        </textarea>
        <span class="row small">
          {rowsOf(text) === null ? (
            <span class="muted">This filter cannot be written as rows.</span>
          ) : (
            <button
              type="button"
              class="link-button"
              onClick={() => {
                setRows(rowsOf(text) ?? [])
                setMode('rows')
              }}
            >
              Edit as rows
            </button>
          )}
        </span>
      </div>
    )
  }

  const first = props.fields[0]?.name ?? ''
  return (
    <div class="stack" style="gap: 0.5rem">
      <input type="hidden" name={props.name} value={jsonOf(rows, props.fields)} />
      {rows.length === 0 ? <span class="small muted">No condition: every record.</span> : null}
      {rows.map((row, index) => {
        const field = props.fields.find((entry) => entry.name === row.field)
        return (
          <div class="filter-row">
            <select
              aria-label="Field"
              onChange={(event: Event) =>
                update(index, { field: (event.target as HTMLSelectElement).value })
              }
            >
              {props.fields.map((entry) => (
                <option value={entry.name} selected={entry.name === row.field}>
                  {entry.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Operator"
              onChange={(event: Event) =>
                update(index, { op: (event.target as HTMLSelectElement).value })
              }
            >
              {OPERATORS.map((entry) => (
                <option value={entry.op} selected={entry.op === row.op}>
                  {entry.label}
                </option>
              ))}
            </select>
            {row.op === '_is_null' ? (
              <select
                aria-label="Value"
                onChange={(event: Event) =>
                  update(index, { value: (event.target as HTMLSelectElement).value })
                }
              >
                <option value="true" selected={row.value !== 'false'}>
                  yes
                </option>
                <option value="false" selected={row.value === 'false'}>
                  no
                </option>
              </select>
            ) : field?.enum && row.op !== '_in' && row.op !== '_nin' ? (
              <select
                aria-label="Value"
                onChange={(event: Event) =>
                  update(index, { value: (event.target as HTMLSelectElement).value })
                }
              >
                <option value="">—</option>
                {field.enum.map((value) => (
                  <option value={value} selected={value === row.value}>
                    {value}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label="Value"
                value={row.value}
                placeholder={row.op === '_in' || row.op === '_nin' ? 'a, b, c' : 'value'}
                onInput={(event: Event) =>
                  update(index, { value: (event.target as HTMLInputElement).value })
                }
              />
            )}
            <button
              type="button"
              class="button quiet small"
              aria-label="Remove the condition"
              onClick={() => setRows(rows.filter((_, at) => at !== index))}
            >
              ×
            </button>
          </div>
        )
      })}
      <span class="row small">
        <button
          type="button"
          class="link-button"
          disabled={!first}
          onClick={() => setRows([...rows, { field: first, op: '_eq', value: '' }])}
        >
          Add a condition
        </button>
        <span class="muted">·</span>
        <button
          type="button"
          class="link-button"
          onClick={() => {
            setText(jsonOf(rows, props.fields))
            setMode('json')
          }}
        >
          Write json
        </button>
      </span>
    </div>
  )
}
