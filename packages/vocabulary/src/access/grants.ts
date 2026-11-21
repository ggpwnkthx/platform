import { ident, qualified } from '../core.ts'
import { InvalidName } from '../errors.ts'
import { allPrivileges, columnPrivileges, grantee, privilege } from './privileges.ts'

export interface GrantDraft {
  schema: string
  /** The collection; null when the grant is on the workspace's schema itself. */
  table: string | null
  privileges: string[]
  /** The fields a grant is limited to; empty for the whole collection. */
  columns: string[]
  /** Who receives the grant: one role, or several. */
  grantee: string | string[]
  withGrantOption: boolean
}

/**
 * A grant, or the revocation of one. A field list may only narrow the privileges
 * PostgreSQL allows it to narrow; the others cover the whole collection, and every
 * privilege at once cannot be narrowed at all — it would grant more than was asked for.
 */
export function grantStatement(draft: GrantDraft, revoke = false): string {
  const privileges = draft.privileges.map(privilege)
  if (!privileges.length) throw new InvalidName('Choose at least one privilege')
  const who = (Array.isArray(draft.grantee) ? draft.grantee : [draft.grantee]).map(grantee)
  if (!who.length) throw new InvalidName('Choose who receives it')
  const columns = draft.columns.map(ident)
  if (columns.length) {
    if (!draft.table) throw new InvalidName('Fields belong to a collection')
    if (privileges.includes(allPrivileges))
      throw new InvalidName(
        'Every privilege cannot be limited to fields: name the privileges themselves.'
      )
  }
  const narrowable = new Set<string>(columnPrivileges)
  const list = privileges
    .map((p) => (columns.length && narrowable.has(p) ? `${p} (${columns.join(', ')})` : p))
    .join(', ')
  const object = draft.table
    ? `TABLE ${qualified(draft.schema, draft.table)}`
    : `SCHEMA ${ident(draft.schema)}`
  const roles = who.join(', ')
  return revoke
    ? `REVOKE ${list} ON ${object} FROM ${roles};`
    : `GRANT ${list} ON ${object} TO ${roles}${draft.withGrantOption ? ' WITH GRANT OPTION' : ''};`
}

/**
 * What one role holds of one privilege on one collection, as the collection's own ACL says
 * it: on the whole collection, on some of its fields, or both.
 */
export interface Held {
  whole: boolean
  columns: string[]
}

/** What a role is to hold of one privilege: nothing, the whole collection, or these fields. */
export type Wanted = 'none' | 'all' | string[]

export interface GrantChange {
  schema: string
  table: string
  grantee: string
  /** What the ACL holds now, by privilege. A privilege it does not name is not held. */
  held: Record<string, Held | undefined>
  /** What it is to hold, by privilege. A privilege it does not name is left as it is. */
  wanted: Record<string, Wanted | undefined>
  /** Whether what is newly granted may be passed on. */
  withGrantOption?: boolean
}

/** Can PostgreSQL limit this privilege to fields? */
export const narrows = (name: string): boolean =>
  (columnPrivileges as readonly string[]).includes(privilege(name))

/**
 * The statements that take a role from what it holds on a collection to what it is to hold:
 * the revocations first, then the grants, and nothing for what is already as wanted.
 *
 * PostgreSQL's two levels do not mirror each other. Revoking a privilege on the collection
 * takes its field grants with it; revoking it on a field leaves a grant on the collection
 * untouched. So a privilege narrowed from the whole collection to some fields is revoked on
 * the collection and granted again on those fields, and one widened from fields to the whole
 * collection gives its field grants up, so that the ACL says once what the role holds.
 */
export function grantChangeStatements(change: GrantChange): string[] {
  const revokeWhole: string[] = []
  const grantWhole: string[] = []
  // Field lists, each with the privileges it is revoked from or granted to.
  const revokeFields = new Map<string, { columns: string[]; privileges: string[] }>()
  const grantFields = new Map<string, { columns: string[]; privileges: string[] }>()
  const fields = (
    into: Map<string, { columns: string[]; privileges: string[] }>,
    name: string,
    columns: string[]
  ) => {
    if (!columns.length) return
    const key = JSON.stringify(columns)
    const entry = into.get(key) ?? { columns, privileges: [] }
    entry.privileges.push(name)
    into.set(key, entry)
  }
  for (const [written, wanted] of Object.entries(change.wanted)) {
    if (wanted === undefined) continue
    const name = privilege(written)
    const held = change.held[written] ?? change.held[name] ?? { whole: false, columns: [] }
    if (wanted === 'none') {
      if (held.whole || held.columns.length) revokeWhole.push(name)
    } else if (wanted === 'all') {
      fields(revokeFields, name, held.columns)
      if (!held.whole) grantWhole.push(name)
    } else {
      if (!narrows(name))
        throw new InvalidName(`${name} covers the whole collection: it cannot be limited to fields`)
      if (!wanted.length) throw new InvalidName(`Choose the fields ${name} is limited to`)
      if (held.whole) {
        revokeWhole.push(name)
        fields(grantFields, name, wanted)
      } else {
        fields(
          revokeFields,
          name,
          held.columns.filter((column) => !wanted.includes(column))
        )
        fields(
          grantFields,
          name,
          wanted.filter((column) => !held.columns.includes(column))
        )
      }
    }
  }
  const draft = (privileges: string[], columns: string[], withGrantOption = false): GrantDraft => ({
    schema: change.schema,
    table: change.table,
    privileges,
    columns,
    grantee: change.grantee,
    withGrantOption,
  })
  const option = Boolean(change.withGrantOption)
  return [
    ...[...revokeFields.values()].map((f) => grantStatement(draft(f.privileges, f.columns), true)),
    ...(revokeWhole.length ? [grantStatement(draft(revokeWhole, []), true)] : []),
    ...(grantWhole.length ? [grantStatement(draft(grantWhole, [], option))] : []),
    ...[...grantFields.values()].map((f) => grantStatement(draft(f.privileges, f.columns, option))),
  ]
}
