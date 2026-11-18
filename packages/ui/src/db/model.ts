import { ident, InvalidName, literal, qualified, role } from './sql.ts'

/**
 * The model, written as the statements PostgreSQL runs. A builder in the interface produces
 * a draft; the draft becomes these statements, which are shown before they run and are run,
 * as the reader, exactly as shown. PostgreSQL decides whether the reader may.
 */

export const fieldTypes = {
  text: 'text',
  integer: 'integer',
  bigint: 'bigint',
  decimal: 'numeric',
  float: 'double precision',
  boolean: 'boolean',
  date: 'date',
  time: 'time',
  timestamp: 'timestamptz',
  uuid: 'uuid',
  json: 'jsonb',
  relation: 'uuid',
} as const

export type FieldType = keyof typeof fieldTypes

export const fieldTypeLabels: Record<FieldType, string> = {
  text: 'Text',
  integer: 'Whole number',
  bigint: 'Large whole number',
  decimal: 'Exact decimal',
  float: 'Floating point',
  boolean: 'Yes / no',
  date: 'Date',
  time: 'Time of day',
  timestamp: 'Moment (with time zone)',
  uuid: 'UUID',
  json: 'JSON document',
  relation: 'Relation to another collection',
}

export type OnDelete = 'restrict' | 'cascade' | 'set_null'

export interface FieldDraft {
  name: string
  type: FieldType
  required: boolean
  unique: boolean
  indexed: boolean
  /** A default value, as typed; empty for none. */
  default: string
  note: string
  maxLength?: number
  choices?: string[]
  min?: number
  max?: number
  /** The collection a relation points at, in the same workspace. */
  relation?: string
  onDelete?: OnDelete
}

/** The columns every collection is made with, by platform.create_collection. */
export const systemFields = [
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'version',
]

export function emptyField(): FieldDraft {
  return {
    name: '',
    type: 'text',
    required: false,
    unique: false,
    indexed: false,
    default: '',
    note: '',
  }
}

/** A default value as the column's type would read it. */
function defaultLiteral(field: FieldDraft): string {
  const text = field.default.trim()
  if (['integer', 'bigint', 'decimal', 'float'].includes(field.type)) {
    if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(text))
      throw new InvalidName(`${field.name}: the default is not a number`)
    return text
  }
  if (field.type === 'boolean') {
    if (!/^(true|false)$/i.test(text))
      throw new InvalidName(`${field.name}: the default is true or false`)
    return text.toUpperCase()
  }
  return literal(text)
}

/** The column definition: type, default, NOT NULL, UNIQUE and the CHECKs its options ask for. */
export function columnSql(field: FieldDraft): string {
  if (systemFields.includes(field.name))
    throw new InvalidName(`${field.name} is made with every collection`)
  const name = ident(field.name)
  let sql = `${name} ${fieldTypes[field.type]}`
  if (field.default.trim()) sql += ` DEFAULT ${defaultLiteral(field)}`
  if (field.required) sql += ' NOT NULL'
  if (field.unique) sql += ' UNIQUE'
  if (field.maxLength !== undefined) sql += ` CHECK (char_length(${name}) <= ${field.maxLength})`
  if (field.choices?.length)
    sql += ` CHECK (${name} IN (${field.choices.map((c) => literal(c)).join(', ')}))`
  if (field.min !== undefined) sql += ` CHECK (${name} >= ${field.min})`
  if (field.max !== undefined) sql += ` CHECK (${name} <= ${field.max})`
  return sql
}

/**
 * The name a relation's constraint carries: the same one `apply` gives it, so a model made
 * here and a manifest applied later agree on what already exists.
 */
export async function relationName(table: string, field: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${table}\0${field}`)
  )
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `fk_${hex.slice(0, 24)}`
}

const onDeleteSql: Record<OnDelete, string> = {
  restrict: 'RESTRICT',
  cascade: 'CASCADE',
  set_null: 'SET NULL',
}

/** The statements that add one field to a collection. */
export async function fieldStatements(
  schema: string,
  table: string,
  field: FieldDraft
): Promise<string[]> {
  const target = qualified(schema, table)
  const out = [`ALTER TABLE ${target} ADD COLUMN ${columnSql(field)};`]
  if (field.indexed && !field.unique) out.push(`CREATE INDEX ON ${target} (${ident(field.name)});`)
  if (field.type === 'relation') {
    if (!field.relation) throw new InvalidName(`${field.name}: choose the collection it points at`)
    out.push(
      `ALTER TABLE ${target} ADD CONSTRAINT ${ident(await relationName(table, field.name))}
  FOREIGN KEY (${ident(field.name)}) REFERENCES ${qualified(schema, field.relation)} (id) ON DELETE ${onDeleteSql[field.onDelete ?? 'restrict']};`
    )
  }
  if (field.note.trim())
    out.push(`COMMENT ON COLUMN ${target}.${ident(field.name)} IS ${literal(field.note.trim())};`)
  return out
}

/** The statements that make a collection: the platform's table, then each field. */
export async function collectionStatements(
  schema: string,
  name: string,
  note: string,
  fields: FieldDraft[]
): Promise<string[]> {
  qualified(schema, name)
  const out = [`SELECT platform.create_collection(${literal(schema)}, ${literal(name)});`]
  for (const field of fields) out.push(...(await fieldStatements(schema, name, field)))
  if (note.trim())
    out.push(`COMMENT ON TABLE ${qualified(schema, name)} IS ${literal(note.trim())};`)
  return out
}

export function workspaceStatements(name: string, owner: string | null): string[] {
  return [`CREATE SCHEMA ${ident(name)}${owner ? ` AUTHORIZATION ${role(owner)}` : ''};`]
}

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

export interface GrantDraft {
  schema: string
  table: string
  privileges: string[]
  /** Empty for the whole table. */
  columns: string[]
  grantee: string
  withGrantOption: boolean
}

export function grantStatement(draft: GrantDraft, revoke = false): string {
  if (!draft.privileges.length) throw new InvalidName('Choose at least one privilege')
  if (!draft.grantee) throw new InvalidName('Choose who receives it')
  const columns = draft.columns.length ? ` (${draft.columns.map(ident).join(', ')})` : ''
  const privileges = draft.privileges.map((p) => `${p}${columns}`).join(', ')
  const grantee = draft.grantee === 'PUBLIC' ? 'PUBLIC' : role(draft.grantee)
  const target = qualified(draft.schema, draft.table)
  return revoke
    ? `REVOKE ${privileges} ON ${target} FROM ${grantee};`
    : `GRANT ${privileges} ON ${target} TO ${grantee}${draft.withGrantOption ? ' WITH GRANT OPTION' : ''};`
}

export function schemaGrantStatement(
  schema: string,
  privileges: string[],
  grantee: string,
  revoke = false
): string {
  if (!privileges.length) throw new InvalidName('Choose at least one privilege')
  if (!grantee) throw new InvalidName('Choose who receives it')
  const who = grantee === 'PUBLIC' ? 'PUBLIC' : role(grantee)
  return revoke
    ? `REVOKE ${privileges.join(', ')} ON SCHEMA ${ident(schema)} FROM ${who};`
    : `GRANT ${privileges.join(', ')} ON SCHEMA ${ident(schema)} TO ${who};`
}

export type PolicyCommand = 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

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

export function policyStatement(draft: PolicyDraft): string {
  if (!draft.name.trim()) throw new InvalidName('Name the policy')
  const roles = draft.roles.length
    ? draft.roles.map((r) => (r === 'PUBLIC' ? 'PUBLIC' : role(r))).join(', ')
    : 'PUBLIC'
  const lines = [
    `CREATE POLICY ${ident(draft.name.trim())} ON ${qualified(draft.schema, draft.table)}`,
    `  AS ${draft.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${draft.command} TO ${roles}`,
  ]
  const usable = draft.command !== 'INSERT'
  const checkable = draft.command !== 'SELECT' && draft.command !== 'DELETE'
  if (usable && draft.using.trim()) lines.push(`  USING (${draft.using.trim()})`)
  if (checkable && draft.check.trim()) lines.push(`  WITH CHECK (${draft.check.trim()})`)
  if (!(usable && draft.using.trim()) && !(checkable && draft.check.trim()))
    throw new InvalidName('A policy needs a USING or a WITH CHECK expression')
  return `${lines.join('\n')};`
}

export function dropPolicyStatement(schema: string, table: string, name: string): string {
  return `DROP POLICY ${ident(name)} ON ${qualified(schema, table)};`
}

export function rowSecurityStatement(schema: string, table: string, enable: boolean): string {
  return `ALTER TABLE ${qualified(schema, table)} ${enable ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY;`
}

export interface MembershipDraft {
  role: string
  member: string
  admin: boolean
}

export function membershipStatement(draft: MembershipDraft, revoke = false): string {
  if (!draft.role || !draft.member) throw new InvalidName('Choose a group and a member')
  return revoke
    ? `REVOKE ${role(draft.role)} FROM ${role(draft.member)};`
    : `GRANT ${role(draft.role)} TO ${role(draft.member)}${draft.admin ? ' WITH ADMIN OPTION' : ''};`
}

export interface RoleDraft {
  name: string
  login: boolean
}

export function createRoleStatements(draft: RoleDraft): string[] {
  if (!draft.name.trim()) throw new InvalidName('Name the role')
  const name = role(draft.name.trim())
  const out = [`CREATE ROLE ${name} ${draft.login ? 'LOGIN' : 'NOLOGIN'};`]
  // A person needs the platform's group to connect and read the helpers.
  if (draft.login) out.push(`GRANT platform_users TO ${name};`)
  return out
}

export function dropFieldStatement(schema: string, table: string, field: string): string {
  return `ALTER TABLE ${qualified(schema, table)} DROP COLUMN ${ident(field)};`
}

export function dropCollectionStatement(schema: string, table: string): string {
  return `DROP TABLE ${qualified(schema, table)};`
}

export function commentStatement(schema: string, table: string, note: string): string {
  return `COMMENT ON TABLE ${qualified(schema, table)} IS ${note.trim() ? literal(note.trim()) : 'NULL'};`
}
