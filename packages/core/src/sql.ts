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
const lit = (value: unknown) =>
  value === null || value === undefined
    ? sql.raw('NULL')
    : sql.lit(typeof value === 'object' ? JSON.stringify(value) : (value as string))
const list = (items: RawBuilder<unknown>[]) => sql.join(items, sql.raw(', '))
/** One statement, as text: every value in it is a quoted name or an inlined literal. */
const stmt = (strings: TemplateStringsArray, ...values: unknown[]) =>
  `${sql(strings, ...values).compile(k).sql};`

// ---------------------------------------------------------------------------- privileges

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
function privilege(name: string): string {
  const upper = name.trim().toUpperCase()
  const full = upper === 'ALL' ? all : upper
  if (!known.has(full)) throw new InvalidName(`${name} is not a privilege`)
  return full
}
export const narrows = (name: string) =>
  (columnPrivileges as readonly string[]).includes(privilege(name))
function grantee(name: string) {
  const who = name.trim()
  if (!who) throw new InvalidName('Choose who receives it')
  return who.toLowerCase() === 'public' ? sql.raw('PUBLIC') : id(who)
}

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
  if (columns.length && !draft.table) throw new InvalidName('Fields belong to a collection')
  if (columns.length && privileges.includes(all))
    throw new InvalidName('Every privilege cannot be limited to fields: name the privileges.')
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
/** What is asked for one privilege: none of it, the whole collection, or these fields. */
export type Wanted = 'none' | 'all' | string[]
export interface GrantChange {
  schema: string
  table: string
  grantee: string
  held: Record<string, Held | undefined>
  wanted: Record<string, Wanted | undefined>
}
/**
 * The difference between what an ACL records and what is asked for. PostgreSQL's two levels
 * do not mirror each other: narrowing from the collection to fields revokes on the collection
 * and grants the fields by name; widening gives the field grants up.
 */
export function grantChangeStatements(change: GrantChange): string[] {
  const revokeWhole: string[] = []
  const grantWhole: string[] = []
  const byFields = () => new Map<string, { columns: string[]; privileges: string[] }>()
  const revokeFields = byFields()
  const grantFields = byFields()
  const fields = (into: ReturnType<typeof byFields>, name: string, columns: string[]) => {
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
      if (held.whole) revokeWhole.push(name)
      else
        fields(
          revokeFields,
          name,
          held.columns.filter((c) => !wanted.includes(c))
        )
      fields(
        grantFields,
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
    ...[...revokeFields.values()].map((f) => grantStatement(draft(f.privileges, f.columns), true)),
    ...(revokeWhole.length ? [grantStatement(draft(revokeWhole), true)] : []),
    ...(grantWhole.length ? [grantStatement(draft(grantWhole))] : []),
    ...[...grantFields.values()].map((f) => grantStatement(draft(f.privileges, f.columns))),
  ]
}

// ------------------------------------------------------------------------------ policies

export const policyCommands = ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const
export type PolicyCommand = (typeof policyCommands)[number]
export interface PolicyDraft {
  schema: string
  table: string
  name: string
  permissive: boolean
  command: PolicyCommand
  roles: string[]
  using: string
  check: string
}
export const policyReads = (command: PolicyCommand) => command !== 'INSERT'
export const policyChecks = (command: PolicyCommand) => command !== 'SELECT' && command !== 'DELETE'
/**
 * The expressions are the owner's own SQL and are written as they are. PostgreSQL parses the
 * statement, and runs one statement only, so it is the judge of what an expression may hold.
 */
export function policyStatement(draft: PolicyDraft): string {
  const name = draft.name.trim()
  const using = draft.using.trim()
  const check = draft.check.trim()
  if (!name) throw new InvalidName('Name the policy')
  if (!policyCommands.includes(draft.command)) throw new InvalidName('Unknown policy command')
  if (using && !policyReads(draft.command))
    throw new InvalidName(`A policy for ${draft.command} has no USING: there is no old row.`)
  if (check && !policyChecks(draft.command))
    throw new InvalidName(`A policy for ${draft.command} has no WITH CHECK: no row is written.`)
  const roles = draft.roles.length ? list(draft.roles.map(grantee)) : sql.raw('PUBLIC')
  return stmt`CREATE POLICY ${id(name)} ON ${id(draft.schema, draft.table)} AS ${sql.raw(
    draft.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'
  )} FOR ${sql.raw(draft.command)} TO ${roles}${sql.raw(
    (using ? `\n  USING (${using})` : '') + (check ? `\n  WITH CHECK (${check})` : '')
  )}`
}
export const dropPolicyStatement = (schema: string, table: string, name: string) =>
  stmt`DROP POLICY IF EXISTS ${id(name)} ON ${id(schema, table)}`
export const rowSecurityStatement = (schema: string, table: string, enable: boolean) =>
  stmt`ALTER TABLE ${id(schema, table)} ${sql.raw(enable ? 'ENABLE' : 'DISABLE')} ROW LEVEL SECURITY`

// --------------------------------------------------------------------- roles, workspaces

export const platformUsers = 'platform_users'
export const reservedRole = (role: string) =>
  /^(pg_.*|platform_core|platform_users|platform_admins)$/.test(role)
export function createRoleStatements(draft: { name: string; login: boolean }): string[] {
  const name = draft.name.trim()
  if (!name) throw new InvalidName('Name the role')
  const out = [stmt`CREATE ROLE ${id(name)} ${sql.raw(draft.login ? 'LOGIN' : 'NOLOGIN')}`]
  // A person can sign in once they belong to the platform's users.
  if (draft.login) out.push(stmt`GRANT ${id(platformUsers)} TO ${id(name)}`)
  return out
}
export const dropRoleStatement = (name: string) => stmt`DROP ROLE ${id(name)}`
export function membershipStatement(
  draft: { role: string; member: string; admin?: boolean },
  revoke = false
): string {
  if (!draft.role || !draft.member) throw new InvalidName('Choose a group and a member')
  return revoke
    ? stmt`REVOKE ${id(draft.role)} FROM ${id(draft.member)}`
    : stmt`GRANT ${id(draft.role)} TO ${id(draft.member)}${sql.raw(draft.admin ? ' WITH ADMIN OPTION' : '')}`
}
export const schemaStatement = (name: string, owner?: string | null) =>
  owner
    ? stmt`CREATE SCHEMA ${id(name)} AUTHORIZATION ${id(owner)}`
    : stmt`CREATE SCHEMA ${id(name)}`

// --------------------------------------------------------------------------------- model

export const systemFields = [
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'version',
]
export const columnTypes = {
  text: 'text',
  integer: 'integer',
  bigint: 'bigint',
  decimal: 'numeric',
  float: 'double precision',
  boolean: 'boolean',
  uuid: 'uuid',
  date: 'date',
  time: 'time',
  timestamp: 'timestamptz',
  json: 'jsonb',
} as const
export const onDeleteActions = { restrict: 'RESTRICT', cascade: 'CASCADE', set_null: 'SET NULL' }
export type OnDelete = keyof typeof onDeleteActions

export interface FieldSpec {
  name: string
  type: string
  modifiers?: string[]
  required?: boolean
  unique?: boolean
  indexed?: boolean
  default?: unknown
  maxLength?: number
  choices?: string[]
  min?: number
  max?: number
  note?: string
  relation?: string | null
  onDelete?: OnDelete
  views?: Record<string, string>
  renderers?: Record<string, unknown>
}

/** A relation is stored as the uuid it points at; `string` is the manifests' word for text. */
const storageType = (type: string) =>
  type === 'relation' || type === 'm2o' ? 'uuid' : type === 'string' ? 'text' : type
/** One of the platform's own types, or any type the database holds, named with its schema. */
function typeSql(type: string, modifiers: readonly string[] = []) {
  const parts = type.split('.').map((part) => part.trim())
  if (parts.length > 2 || parts.some((part) => !part))
    throw new InvalidName(`${type} is not a type name`)
  const name =
    type in columnTypes ? sql.raw(columnTypes[type as keyof typeof columnTypes]) : id(...parts)
  if (!modifiers.length) return name
  const given = modifiers.map((m) => (/^\d+$/.test(m.trim()) ? sql.raw(m.trim()) : id(m.trim())))
  return sql`${name}(${list(given)})`
}
function defaultSql(type: string, value: unknown, name: string) {
  if (['integer', 'bigint', 'decimal', 'float'].includes(type)) {
    if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(String(value)))
      throw new InvalidName(`${name}: the default is not a number`)
    return sql.raw(String(value))
  }
  if (type === 'boolean') {
    if (!/^(true|false)$/i.test(String(value)))
      throw new InvalidName(`${name}: the default is true or false`)
    return sql.raw(String(value).toUpperCase())
  }
  return lit(value)
}
function columnSql(field: FieldSpec) {
  if (systemFields.includes(field.name))
    throw new InvalidName(`${field.name} is made with every collection`)
  const name = id(field.name)
  const type = storageType(field.type)
  const number = (value: number) => {
    if (!Number.isFinite(value)) throw new InvalidName(`${field.name}: not a number`)
    return sql.raw(String(value))
  }
  const parts = [sql`${name} ${typeSql(type, field.modifiers)}`]
  if (field.default !== undefined && field.default !== null && field.default !== '')
    parts.push(sql`DEFAULT ${defaultSql(type, field.default, field.name)}`)
  if (field.required) parts.push(sql.raw('NOT NULL'))
  if (field.unique) parts.push(sql.raw('UNIQUE'))
  if (field.maxLength !== undefined)
    parts.push(sql`CHECK (char_length(${name}) <= ${number(field.maxLength)})`)
  if (field.choices?.length)
    parts.push(sql`CHECK (${name} IN (${list(field.choices.map((choice) => lit(choice)))}))`)
  if (field.min !== undefined) parts.push(sql`CHECK (${name} >= ${number(field.min)})`)
  if (field.max !== undefined) parts.push(sql`CHECK (${name} <= ${number(field.max)})`)
  return sql.join(parts, sql.raw(' '))
}
/** A real foreign key to another collection of the same workspace, named by PostgreSQL. */
export const relationStatement = (
  schema: string,
  table: string,
  field: string,
  related: string,
  onDelete: OnDelete = 'restrict'
) =>
  stmt`ALTER TABLE ${id(schema, table)} ADD FOREIGN KEY (${id(field)}) REFERENCES ${id(schema, related)} (id) ON DELETE ${sql.raw(onDeleteActions[onDelete] ?? 'RESTRICT')}`

/** Everything a new field is: the column, its index, its key, its note and its sayings. */
export function fieldStatements(
  schema: string,
  table: string,
  field: FieldSpec,
  withRelation = true
): string[] {
  const target = fieldTarget(schema, table, field.name)
  const out = [stmt`ALTER TABLE ${id(schema, table)} ADD COLUMN ${columnSql(field)}`]
  if (field.indexed && !field.unique)
    out.push(stmt`CREATE INDEX ON ${id(schema, table)} (${id(field.name)})`)
  if (field.relation && withRelation)
    out.push(relationStatement(schema, table, field.name, field.relation, field.onDelete))
  if (field.note?.trim())
    out.push(stmt`COMMENT ON COLUMN ${id(schema, table, field.name)} IS ${lit(field.note.trim())}`)
  out.push(fieldViewsStatement(target, field.views))
  if (field.renderers && Object.keys(field.renderers).length)
    out.push(metadataStatement(target, renderersKey, field.renderers))
  return out
}
export const createCollectionStatements = (schema: string, name: string): string[] => [
  stmt`SELECT platform.create_collection(${lit(schema)}, ${lit(name)})`,
  fieldsViewsStatement(systemFields.map((column) => fieldTarget(schema, name, column))),
]
export function collectionStatements(
  schema: string,
  name: string,
  note: string,
  fields: readonly FieldSpec[]
): string[] {
  const out = createCollectionStatements(schema, name)
  // Relations come last: a collection may point at itself, or at a field made after it.
  for (const field of fields) out.push(...fieldStatements(schema, name, field, false))
  for (const field of fields)
    if (field.relation)
      out.push(relationStatement(schema, name, field.name, field.relation, field.onDelete))
  if (note.trim()) out.push(commentCollectionStatement(schema, name, note))
  return out
}
export const dropFieldStatement = (schema: string, table: string, field: string) =>
  stmt`ALTER TABLE ${id(schema, table)} DROP COLUMN ${id(field)}`
export const dropCollectionStatement = (schema: string, table: string) =>
  stmt`DROP TABLE ${id(schema, table)}`
export const commentCollectionStatement = (schema: string, table: string, note: string) =>
  stmt`COMMENT ON TABLE ${id(schema, table)} IS ${lit(note.trim() || null)}`

// ------------------------------------------------------------------------------ metadata

export type MetadataScope = 'workspace' | 'collection' | 'field'
export interface MetadataTarget {
  scope: MetadataScope
  schema: string
  table: string | null
  column: string | null
}
export const workspaceTarget = (schema: string): MetadataTarget => ({
  scope: 'workspace',
  schema,
  table: null,
  column: null,
})
export const collectionTarget = (schema: string, table: string): MetadataTarget => ({
  scope: 'collection',
  schema,
  table,
  column: null,
})
export const fieldTarget = (schema: string, table: string, column: string): MetadataTarget => ({
  scope: 'field',
  schema,
  table,
  column,
})

export const viewsKey = 'views'
export const renderersKey = 'renderers'
export const viewModes = ['show', 'hide', 'readonly'] as const
export type ViewMode = (typeof viewModes)[number]
export const defaultViews = { list: 'show', record: 'show', filter: 'show' } as const

const targetRow = (t: MetadataTarget, key: string, value: unknown) =>
  sql`(${lit(t.scope)}, ${lit(t.schema)}, ${lit(t.table)}, ${lit(t.column)}, ${lit(key)}, ${lit(JSON.stringify(value ?? null))}::jsonb)`
const upsert = (rows: RawBuilder<unknown>[]) =>
  stmt`INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value)
VALUES ${sql.join(rows, sql.raw(',\n       '))}
ON CONFLICT (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key)
DO UPDATE SET value = EXCLUDED.value`
export const metadataStatement = (target: MetadataTarget, key: string, value: unknown) =>
  upsert([targetRow(target, key, value)])
export const metadataRemoval = (t: MetadataTarget, key: string) =>
  stmt`DELETE FROM platform.item_metadata
 WHERE scope = ${lit(t.scope)} AND schema_name = ${lit(t.schema)}
   AND table_name IS NOT DISTINCT FROM ${lit(t.table)}
   AND column_name IS NOT DISTINCT FROM ${lit(t.column)} AND key = ${lit(key)}`
/** A null value takes the key away; anything else is written. */
export const metadataStatements = (
  target: MetadataTarget,
  changes: readonly { key: string; value: unknown }[]
) =>
  changes.map((change) =>
    change.value === null
      ? metadataRemoval(target, change.key)
      : metadataStatement(target, change.key, change.value)
  )
/** Where a field appears. Every field carries its own saying, so nothing is inferred. */
export function fieldViewsStatement(target: MetadataTarget, views: Record<string, string> = {}) {
  for (const [name, mode] of Object.entries(views))
    if (!viewModes.includes(mode as ViewMode))
      throw new InvalidName(`${name}: a view is shown, hidden or shown and locked`)
  return metadataStatement(target, viewsKey, { ...defaultViews, ...views })
}
export const fieldsViewsStatement = (targets: readonly MetadataTarget[]) =>
  upsert(targets.map((target) => targetRow(target, viewsKey, defaultViews)))
