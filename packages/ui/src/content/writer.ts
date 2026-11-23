import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import {
  columnsOf,
  deleteRecord,
  insertRecord,
  insertRecordWithLinks,
  record,
  setLinks,
  sqlState,
  tableOf,
  transaction,
  updateRecord,
} from '@platform/core'
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
  const { db, catalog, refresh } = useSession()
  const [refusal, setRefusal] = useState<unknown>(null)
  const [deleting, setDeleting] = useState(false)
  const form = useForm<Row>({ mode: 'controlled', initialValues: {} })

  // A field is an input when PostgreSQL would take the write and its owner has not locked it.
  const writable = (f: Field) => {
    if (f.virtual) {
      // Links are rows of the join table: the reader must be able to write that table, and
      // the two keys of a link may be given to them one column at a time.
      if (f.link?.kind !== 'links') return false
      const path = f.link.path
      const join = tableOf(catalog, path.schema, path.table)
      const columns = columnsOf(catalog, path.schema, path.table)
      const keys = [path.fk, path.target].every(
        (name) => columns.find((column) => column.name === name)?.can_insert
      )
      return !!join?.can_delete && keys
    }
    return (
      !f.system &&
      !f.computed &&
      f.views.record !== 'readonly' &&
      !!(id ? f.column?.can_update : f.column?.can_insert)
    )
  }
  const inForm = fields.filter((f) => !f.system && f.views.record !== 'hide')

  const save = async (): Promise<Written> => {
    setRefusal(null)
    const values: Row = {}
    const links: { path: NonNullable<Field['link']>['path']; ids: string[] }[] = []
    for (const f of inForm.filter(writable)) {
      const held = form.values[f.name]
      if (f.virtual) {
        // A relation of rows: the form holds the ids of the rows it is linked to.
        if (!id && (held === '' || held === undefined || held === null)) continue
        if (id && !form.isDirty(f.name)) continue
        const ids = f.type.fromForm ? f.type.fromForm(held, f) : held
        links.push({ path: f.link!.path, ids: (Array.isArray(ids) ? ids : []).map(String) })
        continue
      }
      if (id ? !form.isDirty(f.name) : held === '' || held === undefined || held === null) continue
      try {
        values[f.name] = f.type.fromForm ? f.type.fromForm(held, f) : held
      } catch (error) {
        form.setFieldError(f.name, (error as Error).message)
        return 'refused'
      }
    }
    try {
      if (!id) {
        await db.exclusive(async (one) => {
          if (!links.length) {
            await insertRecord(one, ws, table, values)
            return
          }
          try {
            await insertRecordWithLinks(one, ws, table, values, links)
          } catch (error) {
            // The id of a new row is needed to write its links, and a reader who may not
            // read the row may not have it: the record is written, and its links are not.
            if (sqlState(error) !== '42501') throw error
            await insertRecord(one, ws, table, values)
            notifications.show({
              color: 'yellow',
              message:
                'The record was written; its links were not: you may not read the row you wrote.',
            })
          }
        })
        notifications.show({ color: 'green', message: 'The record was written.' })
        await refresh()
        return 'written'
      }
      await db.exclusive(async (one) =>
        transaction(one, async () => {
          if (Object.keys(values).length) {
            const changed = await updateRecord(one, ws, table, id, values, row?.version as number)
            if (!changed) {
              // No row: a newer version means someone else wrote first; otherwise a policy refused it.
              const now = (await record(one, ws, table, readable, id)) as Row | null
              throw new Error(
                now && now.version !== row?.version
                  ? 'Someone changed this record since you opened it. Read it again before saving.'
                  : 'PostgreSQL changed no row: a row policy refused the change, or the row is gone.'
              )
            }
          }
          for (const link of links) await setLinks(one, link.path, id, link.ids)
        })
      )
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
