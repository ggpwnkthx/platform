import { useEffect, useRef, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import {
  type ColumnInfo,
  type TableInfo,
  deleteRecord,
  insertRecord,
  record,
  updateRecord,
} from '@platform/data'
import { display } from '../../format.ts'
import { metadataRefusal } from '../../metadata/panel.tsx'
import { describe, useSession } from '../../session.tsx'
import { href } from '../../url.ts'

/**
 * What the reader does with a record: saves it, or deletes it. Each says what the database
 * made of it, and what the reader may do next. The form it writes is the form it holds: a
 * save that is refused leaves the reader's own text where it was.
 */
export function useRecordWriter({
  creating,
  errors,
  from,
  id,
  info,
  onSaved,
  readable,
  refresh,
  reload,
  startText,
  table,
  values,
  version,
  ws,
}: {
  creating: boolean
  errors: Record<string, string>
  from: string | null
  id: string
  info: TableInfo | undefined
  /** Called when the record was saved: the form empties itself. */
  onSaved: () => void
  readable: ColumnInfo[]
  refresh: () => Promise<void>
  reload: () => void
  /** What the address says the record starts with: it changes when the address does. */
  startText: string
  table: string
  values: Record<string, unknown>
  version: number | undefined
  ws: string
}) {
  const { withDb, notify } = useSession()
  const location = useLocation()
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState<{ title: string; detail?: string } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  // A record that has just been opened has nothing wrong with it yet.
  useEffect(() => setProblem(null), [ws, table, id, startText])

  const save = async (event?: Event) => {
    event?.preventDefault()
    if (Object.keys(errors).length) return
    setSaving(true)
    setProblem(null)
    try {
      if (creating) {
        const affected = await withDb((db) => insertRecord(db, ws, table, values))
        notify({
          tone: 'success',
          title: affected ? 'Record created' : 'The database created no record',
        })
        // A row of the platform's own may be something the interface itself reads.
        if (info?.system) await refresh().catch(() => undefined)
        location.route(from ?? href('/content/records', { ws, c: table }))
        return
      }
      // The write, and then the record as it stands: when the database changed no row, what
      // it holds now says whether someone else changed it first.
      const outcome = await withDb(async (db) => {
        const affected = await updateRecord(db, ws, table, id, values, version)
        const now = readable.length
          ? await record(
              db,
              ws,
              table,
              readable.map((c) => c.name),
              id
            )
          : null
        return { affected, now }
      })
      if (outcome.affected) {
        notify({ tone: 'success', title: 'Saved' })
        onSaved()
        if (info?.system) await refresh().catch(() => undefined)
        reload()
      } else if (outcome.now && version !== undefined && outcome.now.version !== version) {
        setProblem({
          title: `Changed by ${display(outcome.now.updated_by) || 'someone else'} since you opened it`,
          detail: `It is at version ${display(outcome.now.version)}; you edited version ${version}. Your changes are still in the form: read the record again before saving.`,
        })
      } else {
        setProblem({
          title: 'The database changed no row',
          detail:
            'A row policy on this collection does not let you change this record, or it is no longer there.',
        })
      }
    } catch (error) {
      setProblem(metadataRefusal(ws, table, error) ?? describe(error))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setSaving(true)
    try {
      const affected = await withDb((db) => deleteRecord(db, ws, table, id, version))
      setConfirming(false)
      if (affected) {
        notify({ tone: 'success', title: 'Record deleted' })
        if (info?.system) await refresh().catch(() => undefined)
        location.route(from ?? href('/content/records', { ws, c: table }))
      } else
        setProblem({
          title: 'The database deleted no row',
          detail: 'A row policy keeps this record from you, or it changed since you opened it.',
        })
    } catch (error) {
      setConfirming(false)
      setProblem(describe(error))
    } finally {
      setSaving(false)
    }
  }

  // Save with Ctrl or Cmd + S.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault()
        formRef.current?.requestSubmit()
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })

  return { formRef, saving, confirming, setConfirming, problem, save, remove }
}
