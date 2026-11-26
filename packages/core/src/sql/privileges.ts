import { grantee, id, InvalidName, list, sql, stmt } from './kit.ts'

export const tablePrivileges = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
] as const
export const columnPrivileges = ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] as const
export const schemaPrivileges = ['USAGE', 'CREATE'] as const
const all = 'ALL PRIVILEGES'
const known = new Set<string>([...tablePrivileges, ...schemaPrivileges, all])
export function privilege(name: string): string {
  const upper = name.trim().toUpperCase()
  const full = upper === 'ALL' ? all : upper
  if (!known.has(full)) throw new InvalidName(`${name} is not a privilege`)
  return full
}
export const narrows = (name: string) =>
  (columnPrivileges as readonly string[]).includes(privilege(name))
export interface GrantDraft {
  schema: string
  table: string | null
  privileges: string[]
  columns?: string[]
  grantee: string | string[]
  withGrantOption?: boolean
}
export function grantStatement(draft: GrantDraft, revoke = false): string {
  const privileges = draft.privileges.map(privilege)
  if (!privileges.length) throw new InvalidName('Choose at least one privilege')
  const who = [draft.grantee].flat().map(grantee)
  if (!who.length) throw new InvalidName('Choose who receives it')
  const columns = (draft.columns ?? []).map((column) => id(column))
  if (columns.length && !draft.table) throw new InvalidName('Columns belong to a table')
  if (columns.length && privileges.includes(all))
    throw new InvalidName('Every privilege cannot be limited to columns: name the privileges.')
  const what = list(
    privileges.map((p) =>
      columns.length && narrows(p) ? sql`${sql.raw(p)} (${list(columns)})` : sql.raw(p)
    )
  )
  const on = draft.table
    ? sql`TABLE ${id(draft.schema, draft.table)}`
    : sql`SCHEMA ${id(draft.schema)}`
  return revoke
    ? stmt`REVOKE ${what} ON ${on} FROM ${list(who)}`
    : stmt`GRANT ${what} ON ${on} TO ${list(who)}${sql.raw(draft.withGrantOption ? ' WITH GRANT OPTION' : '')}`
}

export interface Held {
  whole: boolean
  columns: string[]
}
/** What a role holds on a table by the ACL itself: on the whole of it, or on named columns. */
export function heldBy(
  grants: readonly {
    table: string | null
    column: string | null
    grantee: string
    privilege: string
  }[],
  table: string,
  role: string
): Record<string, Held> {
  const held: Record<string, Held> = {}
  const named = (grantee: string) => grantee.toLowerCase() === role.toLowerCase()
  for (const grant of grants.filter((g) => g.table === table && named(g.grantee))) {
    held[grant.privilege] ??= { whole: false, columns: [] }
    if (grant.column) held[grant.privilege]!.columns.push(grant.column)
    else held[grant.privilege]!.whole = true
  }
  return held
}
/** What is asked for one privilege: none of it, the whole table, or these columns. */
export type Wanted = 'none' | 'all' | string[]
export interface GrantChange {
  schema: string
  table: string
  grantee: string
  held: Record<string, Held | undefined>
  wanted: Record<string, Wanted | undefined>
}

/** The columns of one privilege, gathered so that one statement names them together. */
interface Columns {
  columns: string[]
  privileges: string[]
}
const columnsFor = () => new Map<string, Columns>()
const addColumns = (into: Map<string, Columns>, name: string, columns: string[]) => {
  if (!columns.length) return
  const key = JSON.stringify(columns)
  const entry = into.get(key) ?? { columns, privileges: [] }
  entry.privileges.push(name)
  into.set(key, entry)
}

/**
 * The difference between what an ACL rows and what is asked for. PostgreSQL's two levels
 * do not mirror each other: narrowing from the table to columns revokes on the table
 * and grants the columns by name; widening gives the column grants up.
 */
export function grantChangeStatements(change: GrantChange): string[] {
  const revokeWhole: string[] = []
  const grantWhole: string[] = []
  const revokeColumns = columnsFor()
  const grantColumns = columnsFor()
  for (const [written, wanted] of Object.entries(change.wanted)) {
    if (wanted === undefined) continue
    const name = privilege(written)
    const held = change.held[written] ?? change.held[name] ?? { whole: false, columns: [] }
    if (wanted === 'none') {
      if (held.whole || held.columns.length) revokeWhole.push(name)
    } else if (wanted === 'all') {
      addColumns(revokeColumns, name, held.columns)
      if (!held.whole) grantWhole.push(name)
    } else {
      if (!narrows(name))
        throw new InvalidName(`${name} covers the whole table: it cannot be limited to columns`)
      if (!wanted.length) throw new InvalidName(`Choose the columns ${name} is limited to`)
      if (held.whole) revokeWhole.push(name)
      else
        addColumns(
          revokeColumns,
          name,
          held.columns.filter((c) => !wanted.includes(c))
        )
      addColumns(
        grantColumns,
        name,
        held.whole ? wanted : wanted.filter((c) => !held.columns.includes(c))
      )
    }
  }
  const draft = (privileges: string[], columns: string[] = []): GrantDraft => ({
    schema: change.schema,
    table: change.table,
    privileges,
    columns,
    grantee: change.grantee,
  })
  return [
    ...[...revokeColumns.values()].map((f) => grantStatement(draft(f.privileges, f.columns), true)),
    ...(revokeWhole.length ? [grantStatement(draft(revokeWhole), true)] : []),
    ...(grantWhole.length ? [grantStatement(draft(grantWhole))] : []),
    ...[...grantColumns.values()].map((f) => grantStatement(draft(f.privileges, f.columns))),
  ]
}
