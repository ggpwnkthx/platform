import {
  type Catalog,
  type Db,
  type Identity,
  InvalidName,
  onDeleteActions,
  type PresentationIndex,
  tableOf,
} from '@platform/core'
import type { ReactNode } from 'react'

/**
 * A kind of thing PostgreSQL holds beside rows: a column, a constraint, a row policy, a
 * grant, a role. Every kind is the same four answers — how its rows are read, how they are
 * drawn, what its form asks, and the statements a change is — so every page that lists one
 * is the same table, and every change goes through the same surface.
 */
export interface Ctx {
  catalog: Catalog
  identity: Identity
  presentations: PresentationIndex
}
export interface Column<Row> {
  source: string
  label: string
  render?(row: Row, ctx: Ctx): ReactNode
  /** A column of marks is never clipped. */
  wide?: boolean
}
// biome-ignore lint/suspicious/noExplicitAny: each kind names its own row, filter and form
export interface Kind<Row = any, Where = any, Form = any> {
  /** The name its rows are asked for by. */
  name: string
  /** One of them, in words: "column", "row policy". */
  noun: string
  /** The heading its table stands under on a page, and the note beneath it. */
  title: string
  note: string
  /**
   * The verbs of its changes, as PostgreSQL's statements say them: CREATE, ALTER and DROP
   * unless the kind is granted, inserted or ended instead.
   */
  verbs?: { create?: string; update?: string; remove?: string }
  /** What is said where there are none. */
  empty: string
  read(db: Db, where: Where, ctx: Ctx): Promise<Row[]>
  /** What tells one row from another. */
  key(row: Row): string
  columns: Column<Row>[]
  /**
   * Whether the change is offered. It is PostgreSQL's own answer, read from the catalog — who
   * owns the thing — and never a rule of the interface's: PostgreSQL still judges the statement.
   */
  may?(where: Where, ctx: Ctx): boolean
  /** The same answer where it differs from row to row. */
  mayRow?(row: Row, where: Where, ctx: Ctx): boolean
  /** The inputs of its form, and what the form starts with. */
  Inputs?(props: { where: Where; row?: Row }): ReactNode
  defaults?(where: Where, row: Row | undefined, ctx: Ctx): Partial<Form>
  /** The statements a change is. Throwing says why there are none yet. */
  create?(form: Form, where: Where, ctx: Ctx): string[]
  update?(form: Form, where: Where, row: Row, ctx: Ctx): string[]
  remove?(row: Row, where: Where, ctx: Ctx): string[]
  /** What deleting one destroys beyond itself, said before the statement: data a delete takes with it. */
  loses?(row: Row): string
  /**
   * False where a change cannot run inside a transaction — VACUUM, an index made CONCURRENTLY —
   * so its statements run one after another, each its own, and one refused stops the rest.
   */
  atomic?: boolean
}

const kinds = new Map<string, Kind>()
export const defineKind = <Row, Where, Form>(kind: Kind<Row, Where, Form>) => {
  kinds.set(kind.name, kind)
  return kind
}
export const kindNamed = (name: string) => kinds.get(name)

/** The rows of one of the platform's catalog views, for the place in view: a kind's `read`. */
export const fromView =
  <Row>(view: string, by: string[], order: string) =>
  async (db: Db, where: object) =>
    (
      await db.query<Row>(
        `SELECT * FROM platform.${view}${by.length ? ' WHERE ' : ''}${by.map((k, at) => `"${k}" = $${at + 1}`).join(' AND ')} ORDER BY ${order}`,
        by.map((k) => (where as Record<string, unknown>)[k])
      )
    ).rows

/** What the forms of every kind share. */
export interface Place {
  schema: string
  table: string
}
export const choices = (names: readonly string[]) => names.map((id) => ({ id, name: id }))
export const mono = { className: 'mono', helperText: false } as const
export const required = (value: unknown, what: string) => {
  const text = String(value ?? '').trim()
  if (!text) throw new InvalidName(what)
  return text
}
export const onDelete = Object.entries(onDeleteActions).map(([id, name]) => ({ id, name }))
export const ownsTable = ({ schema, table }: Place, { catalog }: { catalog: Catalog }) =>
  !!tableOf(catalog, schema, table)?.can_alter
export const ownsSchema = ({ schema }: { schema: string }, { catalog }: { catalog: Catalog }) =>
  !!catalog.schemas.find((s) => s.name === schema)?.can_alter
export const createsIn = ({ schema }: { schema: string }, { catalog }: { catalog: Catalog }) =>
  !!catalog.schemas.find((s) => s.name === schema)?.can_create
/** Who may grant is PostgreSQL's answer: the owner, or a role that holds a right WITH GRANT OPTION. */
export const grantsOn = (
  { schema, table }: { schema: string; table?: string },
  { catalog }: { catalog: Catalog }
) =>
  !!(table ? tableOf(catalog, schema, table) : catalog.schemas.find((s) => s.name === schema))
    ?.can_grant
