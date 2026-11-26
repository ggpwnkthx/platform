import { grantee, id, InvalidName, list, sql, stmt } from './kit.ts'

/**
 * Grants beyond a schema and its tables: the rights new objects start with (default
 * privileges), the rights on a sequence, a function or a type, and on the database itself.
 */
export const defaultObjects = {
  TABLES: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'],
  SEQUENCES: ['USAGE', 'SELECT', 'UPDATE'],
  FUNCTIONS: ['EXECUTE'],
  TYPES: ['USAGE'],
} as const
export type DefaultObjects = keyof typeof defaultObjects
export const objectPrivileges = {
  SEQUENCE: defaultObjects.SEQUENCES,
  FUNCTION: defaultObjects.FUNCTIONS,
  PROCEDURE: defaultObjects.FUNCTIONS,
  TYPE: defaultObjects.TYPES,
  DOMAIN: defaultObjects.TYPES,
} as const
export type ObjectKind = keyof typeof objectPrivileges
export const databasePrivileges = ['CONNECT', 'CREATE', 'TEMPORARY'] as const

function privilegesOf(asked: readonly string[], known: readonly string[]) {
  const out = asked.map((p) => p.trim().toUpperCase())
  if (!out.length) throw new InvalidName('Choose at least one privilege')
  for (const p of out) if (!known.includes(p)) throw new InvalidName(`${p} is not a privilege here`)
  return sql.raw(out.join(', '))
}
const who = (names: string | string[]) => {
  const all = [names].flat().filter((n) => n?.trim())
  if (!all.length) throw new InvalidName('Choose who receives it')
  return list(all.map(grantee))
}
const option = (grantable?: boolean) => sql.raw(grantable ? ' WITH GRANT OPTION' : '')

export interface DefaultDraft {
  /** The role whose new objects these are; PostgreSQL lets its members say so. */
  forRole: string
  /** A schema, or none for every schema. */
  schema: string | null
  objects: DefaultObjects
  privileges: string[]
  grantee: string | string[]
  grantable?: boolean
}
export function defaultPrivilegeStatement(draft: DefaultDraft, revoke = false) {
  const known = defaultObjects[draft.objects]
  if (!known) throw new InvalidName(`${draft.objects} are not objects with defaults`)
  const scope = sql`FOR ROLE ${id(draft.forRole)}${draft.schema ? sql` IN SCHEMA ${id(draft.schema)}` : sql.raw('')}`
  const what = privilegesOf(draft.privileges, known)
  return revoke
    ? stmt`ALTER DEFAULT PRIVILEGES ${scope} REVOKE ${what} ON ${sql.raw(draft.objects)} FROM ${who(draft.grantee)}`
    : stmt`ALTER DEFAULT PRIVILEGES ${scope} GRANT ${what} ON ${sql.raw(draft.objects)} TO ${who(draft.grantee)}${option(draft.grantable)}`
}

export interface ObjectGrantDraft {
  objects: ObjectKind
  /** The object as PostgreSQL names it in its catalog: a qualified name, a function's signature. */
  name: string
  privileges: string[]
  grantee: string | string[]
  grantable?: boolean
}
/** A name as the catalog writes one: quoted where it must be, a signature for a function. */
const catalogName = (name: string) => {
  const text = name.trim()
  if (!text || /;|--|\/\*/.test(text)) throw new InvalidName('Choose one of the schema’s objects')
  return sql.raw(text)
}
export function objectGrantStatement(draft: ObjectGrantDraft, revoke = false) {
  const known = objectPrivileges[draft.objects]
  if (!known) throw new InvalidName(`${draft.objects} is not an object that is granted`)
  const what = privilegesOf(draft.privileges, known)
  const on = sql`${sql.raw(draft.objects)} ${catalogName(draft.name)}`
  return revoke
    ? stmt`REVOKE ${what} ON ${on} FROM ${who(draft.grantee)}`
    : stmt`GRANT ${what} ON ${on} TO ${who(draft.grantee)}${option(draft.grantable)}`
}

export function databaseGrantStatement(
  database: string,
  draft: { privileges: string[]; grantee: string | string[]; grantable?: boolean },
  revoke = false
) {
  const what = privilegesOf(draft.privileges, databasePrivileges)
  return revoke
    ? stmt`REVOKE ${what} ON DATABASE ${id(database)} FROM ${who(draft.grantee)}`
    : stmt`GRANT ${what} ON DATABASE ${id(database)} TO ${who(draft.grantee)}${option(draft.grantable)}`
}
