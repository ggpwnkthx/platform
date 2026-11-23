import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { deleteRecord, insertRecord, record, sqlState, updateRecord } from '@platform/core'
import { useState } from 'react'
import type { Field } from '../fields/types.ts'
import { useSession } from '../session/context.ts'
import type { Row } from './query.ts'

/** What a write did: written, nothing to write, or refused by PostgreSQL. */
export type Written = 'written' | 'unchanged' | 'refused'

/**
 * Writing a record: what the form holds, and what PostgreSQL says when it is saved or
 * removed. A refusal is PostgreSQL's own words, kept for the page to show.
 */
export function useRecordWriter({
  ws,
  table,
  id,
  readable,
  row,
  fields,
}: {
  ws: string
  table: string
  id: string
  readable: string[]
  row: Row | null | undefined
  fields: Field[]
}) {
  const { db, refresh } = useSession()
  const [refusal, setRefusal] = useState<unknown>(null)
  const [deleting, setDeleting] = useState(false)
  const form = useForm<Row>({ mode: 'controlled', initialValues: {} })

  // A field is an input when PostgreSQL would take the write and its owner has not locked it.
  const writable = (f: Field) =>
    !f.system &&
    !f.computed &&
    f.views.record !== 'readonly' &&
    (id ? f.column.can_update : f.column.can_insert)
  const inForm = fields.filter((f) => !f.system && f.views.record !== 'hide')

  const save = async (): Promise<Written> => {
    setRefusal(null)
    const values: Row = {}
    for (const f of inForm.filter(writable)) {
      if (id ? !form.isDirty(f.name) : form.values[f.name] === '' || form.values[f.name] === null)
        continue
      try {
        values[f.name] = f.type.fromForm
          ? f.type.fromForm(form.values[f.name], f)
          : form.values[f.name]
      } catch (error) {
        form.setFieldError(f.name, (error as Error).message)
        return 'refused'
      }
    }
    try {
      if (!id) {
        await insertRecord(db, ws, table, values)
        notifications.show({ color: 'green', message: 'The record was written.' })
        await refresh()
        return 'written'
      }
      if (!Object.keys(values).length) return 'unchanged'
      const changed = await updateRecord(
        db,
        ws,
        table,
        id,
        values,
        row?.version as number | undefined
      )
      if (!changed) {
        // No row: a newer version means someone else wrote first; otherwise a policy refused it.
        const now = (await record(db, ws, table, readable, id)) as Row | null
        throw new Error(
          now && now.version !== row?.version
            ? 'Someone changed this record since you opened it. Read it again before saving.'
            : 'PostgreSQL changed no row: a row policy refused the change, or the row is gone.'
        )
      }
      notifications.show({ color: 'green', message: 'Saved.' })
      await refresh()
      return 'written'
    } catch (error) {
      setRefusal(
        sqlState(error) === '23505' && table === 'item_metadata'
          ? new Error('An item carries a key once: this one is already there.')
          : error
      )
      return 'refused'
    }
  }
  const remove = async (): Promise<Written> => {
    try {
      if (!(await deleteRecord(db, ws, table, id, row?.version as number | undefined)))
        throw new Error(
          'PostgreSQL deleted no row: it changed since you opened it, or a row policy refused.'
        )
      await refresh()
      return 'written'
    } catch (error) {
      setRefusal(error)
      setDeleting(false)
      return 'refused'
    }
  }
  return { form, refusal, deleting, setDeleting, writable, inForm, save, remove }
}
