import { useEffect, useMemo, useState } from 'preact/hooks'
import { ident, qualified } from '@platform/vocabulary'
import { fieldText, fieldValue } from '../../fields/edit.ts'
import type { Field as FieldInfo } from '../../fields/field.ts'

/**
 * What the form holds: the text of each field, what it means, and the statement that saves
 * it. The text is the reader's own, and what was stored is what the database holds: a field
 * that was not touched is not written.
 */
export function useRecordForm({
  creating,
  fields,
  id,
  original,
  startText,
  table,
  ws,
  version,
}: {
  creating: boolean
  fields: FieldInfo[]
  id: string
  original: Record<string, unknown> | null
  /** What the address says the record starts with: it changes when the address does. */
  startText: string
  table: string
  ws: string
  version: number | undefined
}) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  useEffect(() => {
    setDraft(JSON.parse(startText) as Record<string, string>)
  }, [ws, table, id, startText])
  /** What the form held for a field when it opened: the stored value, as text. */
  const storedText = (field: FieldInfo) =>
    creating ? '' : fieldText(field, original?.[field.name])
  /** What the form holds for a field now: what was typed, or what was stored. */
  const textOf = (field: FieldInfo) => draft[field.name] ?? storedText(field)
  const changed = fields.filter(
    (field) => field.name in draft && draft[field.name] !== storedText(field)
  )
  const errors: Record<string, string> = {}
  const values: Record<string, unknown> = {}
  for (const field of changed) {
    const parsed = fieldValue(field, draft[field.name]!)
    if ('error' in parsed) errors[field.name] = parsed.error
    else values[field.name] = parsed.value
  }
  const statement = useMemo(() => {
    const names = Object.keys(values)
    if (!names.length) return null
    if (creating)
      return `INSERT INTO ${qualified(ws, table)} (${names.map(ident).join(', ')}\nVALUES (${names.map((_, i) => `$${i + 1}`).join(', ')});`
    return `UPDATE ${qualified(ws, table)}\n   SET ${names.map((n, i) => `${ident(n)} = $${i + 1}`).join(',\n       ')}\n WHERE id = $${names.length + 1}${version !== undefined ? ` AND version = $${names.length + 2}` : ''};`
  }, [JSON.stringify(values), creating, version])
  return { draft, setDraft, changed, errors, values, statement, textOf }
}
