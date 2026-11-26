import {
  type Db,
  describe,
  type Notice,
  type Result,
  splitStatements,
  sqlState,
  transaction,
  unchanged,
} from '@platform/core'
import type { DataProvider, RaRecord } from 'react-admin'
import { session } from '../session/session.ts'
import { kindNamed } from './kinds.ts'
import * as rows from './rows.ts'

/** What PostgreSQL refused, as an error whose message is its own words and its SQLSTATE. */
export class Refused extends Error {
  code?: string
  detail?: string
  /** Which of the statements PostgreSQL refused, and where in it, when it said. */
  fault?: { statement: number; position?: number; named?: string }
  constructor(cause: unknown) {
    const said = describe(cause)
    super(said.title)
    this.code = sqlState(cause)
    this.detail = said.detail
    const { statement, position } = cause as { statement?: number; position?: string | number }
    if (typeof statement === 'number')
      this.fault = {
        statement,
        position: Number(position) || undefined,
        named: /"([^"]+)"/.exec(String((cause as Error).message))?.[1],
      }
  }
}
const asked = async <T>(work: () => Promise<T>) => {
  try {
    return await work()
  } catch (error) {
    throw error instanceof Refused ? error : new Refused(error)
  }
}

/** The rows of a kind, sorted, searched and paged in the page: a catalog is small. */
async function kindList(name: string, params: Parameters<DataProvider['getList']>[1]) {
  const kind = kindNamed(name)!
  const { db, ...ctx } = session.get()!
  const { q, ...where } = params.filter ?? {}
  let found = (await kind.read(db, where, ctx)).map((row) => ({ ...row, id: kind.key(row) }))
  if (q)
    found = found.filter((row) =>
      JSON.stringify(row).toLowerCase().includes(String(q).toLowerCase())
    )
  const { field: column, order } = params.sort ?? {}
  if (column && column !== 'id')
    found.sort(
      (a, b) =>
        String(a[column] ?? '').localeCompare(String(b[column] ?? ''), undefined, {
          numeric: true,
        }) * (order === 'DESC' ? -1 : 1)
    )
  const { page = 1, perPage = found.length } = params.pagination ?? {}
  return {
    data: found.slice((page - 1) * perPage, page * perPage) as RaRecord[],
    total: found.length,
  }
}

/**
 * Everything the interface reads and writes goes through here, on the reader's own login.
 * A resource is a table (`schema.table`) or a kind; `run` is the one way a
 * change to the model or to access is made: the statements the reader was shown, in one
 * transaction, as them.
 */
export interface Answer {
  fields: string[]
  rows: Record<string, unknown>[]
  command: string
  count: number | null
  /** What PostgreSQL said beside its answer: its warnings and notices. */
  notices: Notice[]
  /** How many statements ran: the answer is the last one's. */
  statements: number
  /** The plan, where one was asked for. */
  plan?: string
}
export interface Provider extends DataProvider {
  /** The statements of a change, in one transaction; or one by one where they cannot be in one. */
  run(statements: string[], atomic?: boolean): Promise<void>
  /**
   * The reader's own statement, on a login of its own, so that it cannot reach the platform's
   * work; or a script, cut into statements and run one at a time in one transaction; or a
   * statement's plan, with ANALYZE run and rolled back.
   */
  sql(text: string, how?: { script?: boolean; explain?: 'plan' | 'analyze' }): Promise<Answer>
}
export const dataProvider: Provider = {
  getList: (resource, params) =>
    asked(() =>
      kindNamed(resource) ? kindList(resource, params) : rows.getList(resource, params)
    ) as never,
  getOne: (resource, { id }) =>
    asked(async () => ({ data: await rows.getOne(resource, String(id)) })) as never,
  getMany: (resource, { ids }) =>
    asked(async () => ({ data: await rows.getMany(resource, ids) })) as never,
  getManyReference: (resource, { target, id, ...params }) =>
    asked(() =>
      rows.getList(resource, { ...params, filter: { ...params.filter, [target]: id } })
    ) as never,
  create: (resource, { data }) =>
    asked(async () => ({ data: await rows.create(resource, data) })) as never,
  update: (resource, { id, data, previousData }) =>
    asked(async () => ({
      data: await rows.update(resource, String(id), data, previousData),
    })) as never,
  updateMany: () =>
    Promise.reject(new Error('Rows are changed one at a time, under the version you saw.')),
  delete: (resource, { id, previousData }) =>
    asked(async () => {
      await rows.remove(resource, [String(id)], { [String(id)]: previousData?.version })
      return { data: previousData }
    }) as never,
  // Each row is deleted under the version the reader saw in the list, as one is.
  deleteMany: (resource, { ids, meta }) =>
    asked(async () => {
      await rows.remove(resource, ids.map(String), meta?.versions)
      return { data: ids }
    }) as never,
  run: (statements, atomic = true) =>
    asked(async () => {
      await session.get()!.db.exclusive(async (one: Db) => {
        const each = async () => {
          // A GRANT or REVOKE that PostgreSQL only warns changed nothing undoes the whole change.
          for (const [at, statement] of statements.entries())
            try {
              unchanged(await one.query(statement))
            } catch (error) {
              throw Object.assign(error as object, { statement: at })
            }
        }
        await (atomic ? transaction(one, each) : each())
      })
      await session.refresh()
    }),
  sql: (text, how = {}) =>
    asked(() => {
      const statements = how.script ? splitStatements(text) : [text]
      if (how.explain && statements.length !== 1)
        throw new Error('A plan is of one statement: run the script as statements.')
      if (how.explain)
        statements[0] = `EXPLAIN (${how.explain === 'analyze' ? 'ANALYZE, BUFFERS, ' : ''}FORMAT TEXT) ${statements[0]}`
      return session.get()!.db.own(
        async (one) => {
          const notices: Notice[] = []
          let result: Result | null = null
          for (const [at, statement] of statements.entries())
            try {
              result = await one.query(statement)
              notices.push(...(result.notices ?? []))
            } catch (error) {
              throw Object.assign(error as object, { statement: at })
            }
          return {
            fields: result!.fields.map((f) => f.name),
            rows: result!.rows,
            command: result!.command,
            count: result!.rowCount,
            notices,
            statements: statements.length,
            plan: how.explain
              ? result!.rows.map((r) => String(Object.values(r)[0])).join('\n')
              : undefined,
          }
        },
        { atomic: statements.length > 1, undo: how.explain === 'analyze' }
      )
    }),
}
