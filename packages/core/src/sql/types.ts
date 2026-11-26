import { id, InvalidName, list, lit, sql, stmt } from './kit.ts'

/**
 * Types a schema makes for its columns: an enum (one of a list of words), a domain (a type
 * with rules of its own), a composite (columns held together) and a range. A column is given one
 * by its qualified name.
 */
const named = (name: unknown, what: string) => {
  const text = String(name ?? '').trim()
  if (!text) throw new InvalidName(`Name the ${what}.`)
  return text
}
const words = (values: readonly string[]) => {
  const out = values.map((v) => v.trim()).filter(Boolean)
  if (!out.length) throw new InvalidName('Give it at least one value.')
  return list(out.map((v) => lit(v)))
}
export const typeKinds = ['enum', 'domain', 'composite', 'range'] as const
export type TypeKind = (typeof typeKinds)[number]
export interface TypeDraft {
  schema: string
  name: string
  kind: TypeKind
  /** An enum's words, in their order. */
  values?: string[]
  /** A domain's type, or a range's subtype: `integer`, `numeric(10,2)`, `date`. */
  base?: string
  notNull?: boolean
  /** A domain's default, in SQL. */
  default?: string
  /** A domain's test, in SQL, about VALUE: `VALUE > 0`. */
  check?: string
  /** A composite's columns, as PostgreSQL writes them: `street text, city text`. */
  columns?: string
}
export function typeStatement(draft: TypeDraft) {
  const name = id(draft.schema, named(draft.name, 'type'))
  const raw = (text: unknown, what: string) => sql.raw(named(text, what))
  switch (draft.kind) {
    case 'enum':
      return stmt`CREATE TYPE ${name} AS ENUM (${words(draft.values ?? [])})`
    case 'composite':
      return stmt`CREATE TYPE ${name} AS (${raw(draft.columns, 'columns')})`
    case 'range':
      return stmt`CREATE TYPE ${name} AS RANGE (SUBTYPE = ${raw(draft.base, 'subtype')})`
    case 'domain': {
      const parts = [
        draft.default?.trim() ? ` DEFAULT ${draft.default.trim()}` : '',
        draft.notNull ? ' NOT NULL' : '',
        draft.check?.trim() ? ` CHECK (${draft.check.trim()})` : '',
      ].join('')
      return stmt`CREATE DOMAIN ${name} AS ${raw(draft.base, 'type it is made of')}${sql.raw(parts)}`
    }
    default:
      throw new InvalidName('Choose what kind of type it is.')
  }
}
/** A word added to an enum, at its end or before another. PostgreSQL never takes one away. */
export const enumValueStatement = (
  schema: string,
  name: string,
  value: string,
  before?: string | null
) =>
  stmt`ALTER TYPE ${id(schema, name)} ADD VALUE IF NOT EXISTS ${lit(named(value, 'value'))}${
    before?.trim() ? sql` BEFORE ${lit(before.trim())}` : sql.raw('')
  }`
export const renameEnumValueStatement = (schema: string, name: string, from: string, to: string) =>
  stmt`ALTER TYPE ${id(schema, name)} RENAME VALUE ${lit(from)} TO ${lit(named(to, 'value'))}`
export const renameTypeStatement = (schema: string, from: string, to: string, kind?: TypeKind) =>
  stmt`ALTER ${sql.raw(kind === 'domain' ? 'DOMAIN' : 'TYPE')} ${id(schema, from)} RENAME TO ${id(named(to, 'type'))}`
export const dropTypeStatement = (schema: string, name: string, kind?: TypeKind) =>
  stmt`DROP ${sql.raw(kind === 'domain' ? 'DOMAIN' : 'TYPE')} ${id(schema, name)}`
