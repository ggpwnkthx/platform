import { useState } from 'react'
import { textOf } from '../fields/values.tsx'
import type { Row } from './query.ts'
import type { useRecordWriter } from './writer.ts'

/**
 * What the form holds when it is first drawn: the values of the record, and the rows it is
 * linked to. The form is drawn once it holds them, so nothing the reader types is
 * overwritten by it.
 */
export function useSeededForm({
  writer,
  row,
  links,
  id,
  params,
  loading,
  seed,
}: {
  writer: ReturnType<typeof useRecordWriter>
  row: Row | null | undefined
  links: Record<string, { id: string; label: string }[]>
  id: string
  params: URLSearchParams
  loading: boolean
  seed: string
}) {
  const [seeded, setSeeded] = useState<string | null>(null)
  if (seeded !== seed && !loading && (!id || row)) {
    // A new record may start from what the address says: v.<field>=…
    const start = Object.fromEntries(
      writer.inForm.map((f) => [
        f.name,
        f.virtual
          ? (f.type.toForm?.(links[f.name] ?? []) ?? [])
          : f.type.toForm
            ? f.type.toForm(row?.[f.name] ?? null)
            : textOf(row?.[f.name] ?? params.get(`v.${f.name}`) ?? ''),
      ])
    )
    for (const f of writer.inForm)
      if (!id && params.has(`v.${f.name}`)) start[f.name] = params.get(`v.${f.name}`)
    writer.form.setInitialValues(start)
    writer.form.setValues(start)
    setSeeded(seed)
  }
  return seeded === seed
}
