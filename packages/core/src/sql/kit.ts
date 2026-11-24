import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type RawBuilder,
  sql,
} from 'kysely'

/**
 * The SQL the platform writes. Kysely does the quoting and the parameters; nothing is ever
 * executed through it — the instance has no driver — so a statement can be shown before it
 * runs, and run by whichever connection the caller holds.
 */
// biome-ignore lint/suspicious/noExplicitAny: the schema is the installation's, not known here
export const k = new Kysely<any>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
})
export { sql }

export class InvalidName extends Error {
  constructor(message = 'Not a valid PostgreSQL name') {
    super(message)
    this.name = 'InvalidName'
  }
}

/** A quoted identifier, or a qualified one. PostgreSQL holds names to 63 bytes. */
export function id(...names: string[]) {
  for (const name of names)
    if (!name || name.includes('\0') || new TextEncoder().encode(name).length > 63)
      throw new InvalidName()
  return sql.id(...names)
}
export const ident = (...names: string[]) => id(...names).compile(k).sql
export const lit = (value: unknown) =>
  value === null || value === undefined
    ? sql.raw('NULL')
    : sql.lit(typeof value === 'object' ? JSON.stringify(value) : (value as string))
export const list = (items: RawBuilder<unknown>[]) => sql.join(items, sql.raw(', '))
/** One statement, as text: every value in it is a quoted name or an inlined literal. */
export const stmt = (strings: TemplateStringsArray, ...values: unknown[]) =>
  `${sql(strings, ...values).compile(k).sql};`

/** A role a privilege or a policy names, or PUBLIC when it names the world. */
export function grantee(name: string) {
  const who = name.trim()
  if (!who) throw new InvalidName('Choose who receives it')
  return who.toLowerCase() === 'public' ? sql.raw('PUBLIC') : id(who)
}

/**
 * A name PostgreSQL would give, held to the length it holds names to: 63 bytes, and not
 * one character more. A name cut here is cut on a character, as PostgreSQL's own is.
 */
export function pgName(name: string): string {
  const bytes = new TextEncoder().encode(name)
  if (bytes.length <= 63) return name
  let out = ''
  let used = 0
  for (const char of name) {
    const size = new TextEncoder().encode(char).length
    if (used + size > 63) break
    out += char
    used += size
  }
  return out
}
