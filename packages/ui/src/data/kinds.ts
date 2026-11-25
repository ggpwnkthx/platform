import type { Catalog, Db, Identity, PresentationIndex } from '@platform/core'
import type { ReactNode } from 'react'

/**
 * A kind of thing PostgreSQL holds beside records: a field, a constraint, a row policy, a
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
  /** One of them, in words: "field", "row policy". */
  noun: string
  /** The heading its table stands under on a page, and the note beneath it. */
  title: string
  note: string
  /** What its add button says, where "Add a <noun>" would not do. */
  add?: string
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
}

const kinds = new Map<string, Kind>()
export const defineKind = <Row, Where, Form>(kind: Kind<Row, Where, Form>) => {
  kinds.set(kind.name, kind)
  return kind
}
export const kindNamed = (name: string) => kinds.get(name)
