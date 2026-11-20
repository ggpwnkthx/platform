import { ident, qualified, role, schemaStatement } from './core.ts'
import { InvalidName } from './errors.ts'

/**
 * The access the platform grants, written once.
 *
 * A privilege, a row policy, a membership and a role are the same things whether the
 * operator's tools grant them from a manifest or the interface grants them in the browser:
 * the same statement, with the same rules about what may be limited to which fields. The
 * operator's tools converge a database on a manifest; the interface shows the reader the
 * statement before it runs. The statement itself is written here, once, so that the two
 * cannot drift apart.
 */

/** The privileges a collection may carry, as PostgreSQL writes them. */
export const tablePrivileges = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
] as const

/**
 * The privileges PostgreSQL may limit to fields. The others always cover the whole
 * collection: a row that may be deleted is deleted whatever its fields say.
 */
export const columnPrivileges = ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] as const

/** The privileges a workspace's schema may carry. */
export const schemaPrivileges = ['USAGE', 'CREATE'] as const

/**
 * The same privileges as a manifest writes them, in lower case. A manifest is written by
 * hand, and PostgreSQL writes its privileges in capitals; these are the two spellings of
 * one vocabulary, kept side by side so that they cannot drift apart.
 */
export const tablePrivilegeNames = [
  'select',
  'insert',
  'update',
  'delete',
  'truncate',
  'references',
  'trigger',
  'all',
] as const

export const schemaPrivilegeNames = ['usage', 'create', 'all'] as const

export const columnPrivilegeNames = ['select', 'insert', 'update', 'references'] as const

/** Every privilege at once. PostgreSQL takes no field list with it. */
export const allPrivileges = 'ALL PRIVILEGES'

/** A privilege as PostgreSQL writes it, whatever case it was written in. */
export function privilege(name: string): string {
  const upper = name.trim().toUpperCase()
  if (upper === 'ALL') return allPrivileges
  return upper
}

/** Who a statement names: PUBLIC is PostgreSQL's own word for everyone. */
export function grantee(name: string): string {
  const who = name.trim()
  if (!who) throw new InvalidName('Choose who receives it')
  return who.toLowerCase() === 'public' ? 'PUBLIC' : role(who)
}

/** The actions a relation's foreign key may take when the row it points at goes. */
export const onDeleteActions = ['restrict', 'cascade', 'set_null'] as const

export type OnDelete = (typeof onDeleteActions)[number]

/** The action as a statement writes it. */
export const onDeleteAction = (action: OnDelete): string =>
  ({ restrict: 'RESTRICT', cascade: 'CASCADE', set_null: 'SET NULL' })[action]

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

export type PolicyCommand = 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

/** The commands a row policy may be written for. */
export const policyCommands: PolicyCommand[] = ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE']

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

/** A policy for INSERT carries no USING: there is no old row to read. */
export const policyReads = (command: PolicyCommand): boolean => command !== 'INSERT'

/** A policy for SELECT or DELETE carries no WITH CHECK: no row is written. */
export const policyChecks = (command: PolicyCommand): boolean =>
  command !== 'SELECT' && command !== 'DELETE'

/**
 * A row policy. PostgreSQL decides which clause a policy may carry: one for INSERT has only
 * a WITH CHECK, one for SELECT or DELETE has only a USING, and one for UPDATE or ALL has
 * both. A policy with neither covers every row, which is what PostgreSQL writes by default.
 *
 * A policy a reader writes must say something about the rows it reaches: `requireExpression`
 * refuses a policy that has neither a USING nor a WITH CHECK. The operator's tools may write
 * one that only says who it is for, so they do not ask for it.
 */
/**
 * Refuses a policy expression that would not stay inside its parentheses. The expression is
 * PostgreSQL's to judge, and it is written into the statement as it is: so it must be one
 * expression, which ends where the statement expects it to. A parenthesis that closes what
 * it did not open, a semicolon, or a quotation or comment left open would end the clause
 * early and let what follows be read as a statement of its own.
 */
export function policyExpression(expression: string, clause: string): string {
  const text = expression.trim()
  const refuse = (why: string) => new InvalidName(`The ${clause} expression ${why}`)
  let depth = 0
  let at = 0
  /** Steps over what is quoted, to the character after the closing quotation. */
  const quoted = (close: string, escapes: boolean) => {
    for (at += 1; at < text.length; at++) {
      if (escapes && text[at] === '\\') at++
      else if (text.startsWith(close, at)) {
        // A quotation mark written twice is the mark itself, not the end.
        if (close.length === 1 && text[at + 1] === close) at++
        else {
          at += close.length
          return
        }
      }
    }
    throw refuse('leaves a quotation open')
  }
  while (at < text.length) {
    const char = text[at]
    const dollar =
      char === '$' ? /^\$([A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$/.exec(text.slice(at)) : null
    if (char === "'")
      quoted("'", at > 0 && /[eE]/.test(text[at - 1] ?? '') && !/\w/.test(text[at - 2] ?? ''))
    else if (char === '"') quoted('"', false)
    else if (dollar && !/[\w$]/.test(text[at - 1] ?? '')) {
      at += dollar[0].length - 1
      quoted(dollar[0], false)
    } else if (text.startsWith('--', at) || text.startsWith('/*', at))
      throw refuse('may not hold a comment')
    else if (char === ';') throw refuse('may not hold a semicolon')
    else {
      if (char === '(') depth++
      if (char === ')' && --depth < 0) throw refuse('closes a parenthesis it did not open')
      at++
    }
  }
  if (depth > 0) throw refuse('leaves a parenthesis open')
  return text
}

export function policyStatement(
  draft: PolicyDraft,
  options?: { requireExpression?: boolean }
): string {
  if (!draft.name.trim()) throw new InvalidName('Name the policy')
  if (options?.requireExpression && !draft.using.trim() && !draft.check.trim())
    throw new InvalidName('A policy needs a USING or a WITH CHECK expression')
  const roles = draft.roles.length ? draft.roles.map(grantee).join(', ') : 'PUBLIC'
  const lines = [
    `CREATE POLICY ${ident(draft.name.trim())} ON ${qualified(draft.schema, draft.table)}`,
    `  AS ${draft.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${draft.command} TO ${roles}`,
  ]
  const reads = policyReads(draft.command)
  const checks = policyChecks(draft.command)
  if (!reads && draft.using.trim())
    throw new InvalidName(
      `A policy for ${draft.command} cannot have a USING expression: there is no old row.`
    )
  if (!checks && draft.check.trim())
    throw new InvalidName(
      `A policy for ${draft.command} cannot have a WITH CHECK expression: no row is written.`
    )
  if (reads && draft.using.trim()) lines.push(`  USING (${policyExpression(draft.using, 'USING')})`)
  if (checks && draft.check.trim())
    lines.push(`  WITH CHECK (${policyExpression(draft.check, 'WITH CHECK')})`)
  return `${lines.join('\n')};`
}

/**
 * The workspace, written as the statements PostgreSQL runs: the schema itself and the
 * rights on it. They are shown to the reader before they run, and then run as the reader.
 */
export const workspaceStatements = (name: string, owner: string | null): string[] => [
  schemaStatement(name, owner),
]

/** The rights on the workspace's own schema. */
export const schemaGrantStatement = (
  schema: string,
  privileges: string[],
  grantee: string,
  revoke = false
): string =>
  grantStatement(
    { schema, table: null, privileges, columns: [], grantee, withGrantOption: false },
    revoke
  )

/** The statement that removes a row policy. */
export function dropPolicyStatement(schema: string, table: string, name: string): string {
  return `DROP POLICY ${ident(name)} ON ${qualified(schema, table)};`
}

/** The statement that turns row security on a collection on or off. */
export function rowSecurityStatement(schema: string, table: string, enable: boolean): string {
  return `ALTER TABLE ${qualified(schema, table)} ${enable ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY;`
}

export interface MembershipDraft {
  role: string
  member: string
  admin: boolean
}

/** A membership: a group and the role that belongs to it. */
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

/** The statement that makes a role: a person who may sign in, or a group. */
export function createRoleStatement(draft: RoleDraft): string {
  if (!draft.name.trim()) throw new InvalidName('Name the role')
  return `CREATE ROLE ${role(draft.name.trim())} ${draft.login ? 'LOGIN' : 'NOLOGIN'};`
}

/** The group every person belongs to, without which a login may not reach the database. */
export const platformUsers = 'platform_users'

/**
 * The statements that make a person: the role, and the group that lets it connect. The
 * operator's tools grant that membership in their own way, so that an existing one is left
 * in place; this is what the interface offers.
 */
export function createRoleStatements(draft: RoleDraft): string[] {
  const name = role(draft.name.trim())
  const out = [createRoleStatement(draft)]
  if (draft.login) out.push(`GRANT ${platformUsers} TO ${name};`)
  return out
}
