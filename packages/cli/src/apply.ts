import type pg from 'pg'
import { z } from 'zod'
import {
  createRoleStatement,
  grantStatement,
  ident,
  membershipStatement,
  type PolicyCommand,
  policyStatement,
  qualified,
  schemaPrivilegeNames,
  schemaStatement,
  tablePrivilegeNames,
} from '@platform/sql'
import { applyCollections, collectionSchema, type Report, relationSchema } from './model.ts'

const name = z.string().min(1)
const state = z.enum(['present', 'absent']).default('present')
const userSchema = z.strictObject({
  name,
  state,
  login: z.boolean().default(true),
  /** The bootstrap administrator's rights: create roles, create workspaces, admit users. */
  admin: z.boolean().optional(),
  groups: z.array(name).default([]),
})
const groupSchema = z.strictObject({ name, state })
/** The privileges a grant may name: those of a collection and those of a workspace. */
const grantPrivileges = z.enum([...new Set([...schemaPrivilegeNames, ...tablePrivilegeNames])] as [
  string,
  ...string[],
])
const grantSchema = z.strictObject({
  to: z.union([name, z.array(name).min(1)]),
  privileges: z.array(grantPrivileges).min(1),
  /** Without a collection the grant is on the workspace itself. */
  collection: name.optional(),
  columns: z.array(name).min(1).optional(),
  state,
})
const policySchema = z.strictObject({
  collection: name,
  name,
  state,
  for: z.enum(['all', 'select', 'insert', 'update', 'delete']).default('all'),
  to: z.array(name).min(1).default(['public']),
  using: name.optional(),
  check: name.optional(),
  restrictive: z.boolean().default(false),
})
const workspaceSchema = z.strictObject({
  slug: name,
  name: z.string().optional(),
  owner: name.optional(),
  collections: z.array(collectionSchema).default([]),
  relations: z.array(relationSchema).default([]),
  grants: z.array(grantSchema).default([]),
  policies: z.array(policySchema).default([]),
})
const manifestSchema = z
  .strictObject({
    format: z.literal(1).optional(),
    users: z.array(userSchema).default([]),
    groups: z.array(groupSchema).default([]),
    workspaces: z.array(workspaceSchema).default([]),
    // A model file is a manifest of one workspace, written with its contents at the top level.
    workspace: workspaceSchema.pick({ slug: true, name: true, owner: true }).optional(),
    collections: z.array(z.unknown()).optional(),
    relations: z.array(z.unknown()).optional(),
    grants: z.array(z.unknown()).optional(),
    policies: z.array(z.unknown()).optional(),
  })
  .transform(({ workspace, collections, relations, grants, policies, ...rest }, ctx) => {
    const contents = { collections, relations, grants, policies }
    if (workspace) rest.workspaces.push(workspaceSchema.parse({ ...workspace, ...contents }))
    else if (Object.values(contents).some(Boolean))
      ctx.addIssue({
        code: 'custom',
        message: 'collections, relations, grants and policies belong to a workspace',
      })
    return rest
  })
export type Manifest = z.infer<typeof manifestSchema>
export type ApplyResult = { changes: string[]; unchanged: number }

const reserved = (role: string) =>
  /^(pg_.*|platform_core|platform_users|platform_admins)$/.test(role)

class Run implements Report {
  changes: string[] = []
  unchanged = 0
  constructor(readonly q: pg.Client) {}
  changed(what: string) {
    this.changes.push(what)
  }
  same() {
    this.unchanged++
  }
  /** Runs statements that are safe to repeat, and reports them only if the catalog moved. */
  async converge(what: string, probe: string, params: unknown[], statements: string[]) {
    const read = async () => JSON.stringify((await this.q.query(probe, params)).rows)
    const before = await read()
    for (const sql of statements) await this.q.query(sql)
    if ((await read()) === before) this.same()
    else this.changed(what)
  }
  async role(role: string): Promise<{ login: boolean } | undefined> {
    if (reserved(role)) throw new Error(`${role} is a reserved role and is not managed here`)
    // The platform answers for itself: the role catalog is not readable by ordinary sessions.
    const found = await this.q.query('SELECT * FROM platform.role_attributes($1)', [role])
    return found.rows[0]
  }
  /** Checked first: an operator who cannot grant a membership may still find it in place. */
  async member(role: string, group: string, adminOption = false) {
    // The membership graph is not readable by ordinary connections, so the platform answers
    // for itself: an operator reads the truth, and anyone else only about themselves.
    const found = await this.q.query('SELECT platform.is_member($1,$2) AS member', [role, group])
    if (found.rows[0]?.member) return this.same()
    await this.q.query(membershipStatement({ role: group, member: role, admin: adminOption }))
    this.changed(`add ${role} to ${group}`)
  }
  /** A user is a role and nothing else: who may claim it is the identity provider's business. */
  async user(user: z.infer<typeof userSchema>, database: string) {
    const q = this.q
    const role = ident(user.name)
    const found = await this.role(user.name)
    if (!found) {
      await q.query(createRoleStatement({ name: user.name, login: user.login }))
      this.changed(`create user ${user.name}`)
    } else if (found.login !== user.login) {
      await q.query(`ALTER ROLE ${role} ${user.login ? 'LOGIN' : 'NOLOGIN'}`)
      this.changed(`${user.login ? 'enable' : 'disable'} login of ${user.name}`)
    } else this.same()
    // Membership of platform_users is what lets a login connect to this database at all.
    for (const group of ['platform_users', ...user.groups]) await this.member(user.name, group)
    if (user.admin === undefined) return
    const rights = await q.query(
      `SELECT a.create_role AS roles, has_database_privilege(a.name, current_database(), 'CREATE') AS creates,
        platform.has_admin_option(a.name) AS admits
        FROM platform.role_attributes($1) a`,
      [user.name]
    )
    const held = rights.rows[0] ?? { roles: false, creates: false, admits: false }
    if (Object.values(held).every((value) => value === user.admin)) {
      this.same()
    } else if (user.admin) {
      await q.query(`ALTER ROLE ${role} CREATEROLE`)
      await q.query(`GRANT platform_users TO ${role} WITH ADMIN OPTION`)
      await q.query(`GRANT CREATE ON DATABASE ${database} TO ${role}`)
      this.changed(`make ${user.name} an administrator`)
    } else {
      await q.query(`ALTER ROLE ${role} NOCREATEROLE`)
      await q.query(`REVOKE ADMIN OPTION FOR platform_users FROM ${role}`)
      await q.query(`REVOKE CREATE ON DATABASE ${database} FROM ${role}`)
      this.changed(`withdraw administration from ${user.name}`)
    }
    // Administrators read the role catalogs, so that they can administer roles and run the
    // operator's own psql session. Ordinary members never do. The group exists from 2.0.1 on.
    const admins = (await q.query("SELECT to_regrole('platform_admins') AS group")).rows[0]?.group
    if (!admins) return
    if (user.admin) await this.member(user.name, 'platform_admins', true)
    else await q.query(`REVOKE platform_admins FROM ${role}`)
  }
  async group(group: string) {
    const found = await this.role(group)
    if (found?.login) throw new Error(`${group} is a login, not a group`)
    if (found) return this.same()
    await this.q.query(createRoleStatement({ name: group, login: false }))
    this.changed(`create group ${group}`)
  }
  /** Dropping is PostgreSQL's decision: a role that still owns or is granted anything stays. */
  async drop(kind: string, role: string) {
    if (reserved(role)) throw new Error(`${role} is a reserved role and is not managed here`)
    try {
      await this.q.query(`DROP ROLE ${ident(role)}`)
    } catch (error) {
      // A role that is not there is already in the state the manifest asks for.
      if ((error as { code?: string }).code === '42704') return this.same()
      throw error
    }
    this.changed(`drop ${kind} ${role}`)
  }
  async grant(schema: string, grant: z.infer<typeof grantSchema>) {
    const allowed = (
      grant.collection ? tablePrivilegeNames : schemaPrivilegeNames
    ) as readonly string[]
    const wrong = grant.privileges.filter((p) => !allowed.includes(p))
    const on = grant.collection ? `${schema}.${grant.collection}` : `workspace ${schema}`
    if (wrong.length) throw new Error(`${wrong.join(', ')} cannot be granted on ${on}`)
    if (grant.columns && !grant.collection)
      throw new Error(`Columns need a collection: grant on ${on}`)
    const sql = grantStatement(
      {
        schema,
        table: grant.collection ?? null,
        privileges: grant.privileges,
        columns: grant.columns ?? [],
        grantee: grant.to,
        withGrantOption: false,
      },
      grant.state === 'absent'
    )
    if (!grant.collection)
      return this.converge(
        sql,
        'SELECT nspacl::text AS acl FROM pg_namespace WHERE nspname=$1',
        [schema],
        [sql]
      )
    await this.converge(
      sql,
      `SELECT c.relacl::text AS acl, ARRAY(SELECT a.attacl::text FROM pg_attribute a
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns
        FROM pg_class c WHERE c.oid=to_regclass($1)`,
      [qualified(schema, grant.collection)],
      [sql]
    )
  }
  /** A policy's command cannot be altered, so it is replaced; the transaction hides the gap. */
  async policy(schema: string, policy: z.infer<typeof policySchema>) {
    const target = `${ident(policy.name)} ON ${qualified(schema, policy.collection)}`
    const statements = [`DROP POLICY IF EXISTS ${target}`]
    if (policy.state === 'present')
      statements.push(
        policyStatement({
          schema,
          table: policy.collection,
          name: policy.name,
          permissive: !policy.restrictive,
          command: policy.for.toUpperCase() as PolicyCommand,
          roles: policy.to,
          using: policy.using ?? '',
          check: policy.check ?? '',
        })
      )
    await this.converge(
      `${policy.state === 'present' ? 'set' : 'drop'} policy ${policy.name} on ${schema}.${policy.collection}`,
      `SELECT permissive,roles::text,cmd,qual,with_check FROM pg_policies
        WHERE schemaname=$1 AND tablename=$2 AND policyname=$3`,
      [schema, policy.collection, policy.name],
      statements
    )
  }
  async workspace(w: z.infer<typeof workspaceSchema>) {
    const q = this.q
    const found = await q.query(
      'SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname=$1',
      [w.slug]
    )
    const owner = found.rows[0]?.owner
    if (owner && w.owner && owner !== w.owner)
      throw new Error(`Workspace ${w.slug} is owned by ${owner}, not ${w.owner}`)
    // Its owner builds collections with the platform's helper, which platform_users may call.
    const able =
      !w.owner ||
      (await q.query("SELECT pg_has_role($1,'platform_users','USAGE') AS ok", [w.owner])).rows[0].ok
    if (!able) await this.member(w.owner!, 'platform_users')
    if (owner) this.same()
    else {
      await q.query(schemaStatement(w.slug, w.owner ?? null))
      this.changed(`create workspace ${w.slug}${w.owner ? ` owned by ${w.owner}` : ''}`)
    }
    // Everything inside is made as the owner, so that it owns it and its grants are its own.
    if (w.owner) await q.query(`SET LOCAL ROLE ${ident(w.owner)}`)
    await applyCollections(q, w.slug, w.collections, w.relations, this)
    for (const grant of w.grants) await this.grant(w.slug, grant)
    for (const policy of w.policies) await this.policy(w.slug, policy)
    if (w.owner) await q.query('RESET ROLE')
  }
}

export const parseManifest = (raw: unknown): Manifest => manifestSchema.parse(raw)

/**
 * Brings a database to what a manifest describes, with the caller's own rights and inside the
 * caller's transaction. It adds and adjusts; it removes only what is marked absent, and never
 * a workspace, a collection or a field.
 */
export async function applyManifest(q: pg.Client, raw: unknown): Promise<ApplyResult> {
  const manifest = parseManifest(raw)
  const run = new Run(q)
  const database = ident((await q.query('SELECT current_database() AS d')).rows[0].d)
  const present = <T extends { state: string }>(all: T[]) =>
    all.filter((x) => x.state === 'present')
  const absent = <T extends { state: string }>(all: T[]) => all.filter((x) => x.state === 'absent')
  for (const group of present(manifest.groups)) await run.group(group.name)
  for (const user of present(manifest.users)) await run.user(user, database)
  for (const workspace of manifest.workspaces) await run.workspace(workspace)
  // Last, once this manifest's own revocations have released what the role held.
  for (const user of absent(manifest.users)) await run.drop('user', user.name)
  for (const group of absent(manifest.groups)) await run.drop('group', group.name)
  return { changes: run.changes, unchanged: run.unchanged }
}
