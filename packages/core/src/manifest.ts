import { z } from 'zod'
import { type Db, requireInstalledVersion, script, transaction } from './db.ts'
import {
  collectionTarget,
  commentCollectionStatement,
  createCollectionStatements,
  createRoleStatements,
  dropPolicyStatement,
  type FieldSpec,
  fieldStatements,
  fieldTarget,
  grantStatement,
  ident,
  membershipStatement,
  type MetadataTarget,
  type PolicyCommand,
  policyStatement,
  relationStatement,
  renderersKey,
  reservedRole,
  rowSecurityStatement,
  schemaPrivileges,
  schemaStatement,
  tablePrivileges,
  viewsKey,
  workspaceTarget,
} from './sql.ts'

// ---------------------------------------------------------------------------- the manifest

const name = z.string().min(1)
const state = z.enum(['present', 'absent']).default('present')
const onDelete = z.enum(['restrict', 'cascade', 'set_null'])
const metadataSchema = z.record(name, z.unknown()).default({})
const fieldSchema = z.object({
  name,
  type: name.regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/, {
    message: 'A type is a name, or a name qualified with the schema it lives in.',
  }),
  modifiers: z.array(name).default([]),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  indexed: z.boolean().default(false),
  default: z.unknown().optional(),
  label: z.string().optional(),
  note: z.string().optional(),
  views: z.record(z.string(), z.enum(['show', 'hide', 'readonly'])).default({}),
  renderers: z.record(z.string(), z.unknown()).default({}),
  metadata: metadataSchema.refine((m) => !(viewsKey in m) && !(renderersKey in m), {
    message: 'A field says where it appears in `views` and how it is drawn in `renderers`.',
  }),
  relation: z
    .object({ collection: z.string(), on_delete: onDelete.default('restrict') })
    .optional(),
  options: z
    .object({
      max_length: z.number().int().positive().optional(),
      choices: z.array(z.string()).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .default({}),
})
const collectionSchema = z.object({
  name,
  fields: z.array(fieldSchema).default([]),
  label: z.string().optional(),
  note: z.string().optional(),
  row_security: z.boolean().optional(),
  metadata: metadataSchema,
})
const relationSchema = z.object({
  collection: z.string(),
  field: z.string(),
  related: z.string(),
  on_delete: onDelete.optional(),
  onDelete: onDelete.optional(),
})
const userSchema = z.strictObject({
  name,
  state,
  login: z.boolean().default(true),
  admin: z.boolean().optional(),
  connections: z.number().int().min(-1).optional(),
  groups: z.array(name).default([]),
  admits: z.array(name).default([]),
})
const groupSchema = z.strictObject({ name, state })
const privilegeNames = [...schemaPrivileges, ...tablePrivileges, 'ALL'].map((p) => p.toLowerCase())
const grantSchema = z.strictObject({
  to: z.union([name, z.array(name).min(1)]),
  privileges: z.array(z.enum(privilegeNames)).min(1),
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
  metadata: metadataSchema,
  collections: z.array(collectionSchema).default([]),
  relations: z.array(relationSchema).default([]),
  grants: z.array(grantSchema).default([]),
  policies: z.array(policySchema).default([]),
})
/** Users, groups and workspaces; a lone `workspace` with its contents beside it is one more. */
export const manifestSchema = z
  .strictObject({
    format: z.literal(1).optional(),
    users: z.array(userSchema).default([]),
    groups: z.array(groupSchema).default([]),
    workspaces: z.array(workspaceSchema).default([]),
    workspace: workspaceSchema
      .pick({ slug: true, name: true, owner: true, metadata: true })
      .optional(),
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
type Field = z.infer<typeof fieldSchema>
type Collection = z.infer<typeof collectionSchema>
type Relation = z.infer<typeof relationSchema>
type Workspace = z.infer<typeof workspaceSchema>
type User = z.infer<typeof userSchema>
export const parseManifest = (raw: unknown): Manifest => manifestSchema.parse(raw)

export const fieldSpec = (field: Field): FieldSpec => ({
  name: field.name,
  type: field.type,
  modifiers: field.modifiers,
  required: field.required,
  unique: field.unique,
  indexed: field.indexed,
  default: field.default,
  maxLength: field.options.max_length,
  choices: field.options.choices,
  min: field.options.min,
  max: field.options.max,
  note: field.note ?? field.label,
  relation: field.relation?.collection ?? null,
  onDelete: field.relation?.on_delete,
  views: field.views,
  renderers: field.renderers,
})

// ------------------------------------------------------------------------------- applying

export interface ApplyResult {
  changes: string[]
  unchanged: number
  notes: string[]
}
/** What an apply did and what it found in place. Every step converges: a second run changes nothing. */
class Run implements ApplyResult {
  changes: string[] = []
  unchanged = 0
  notes: string[] = []
  constructor(readonly db: Db) {}
  async one<Row = Record<string, unknown>>(text: string, params?: unknown[]) {
    return (await this.db.query<Row>(text, params)).rows[0]
  }
  async all(statements: string[]) {
    for (const statement of statements) await this.db.query(statement)
  }
  changed(what: string) {
    this.changes.push(what)
  }
  /** Runs statements and says whether what the probe reads is different afterwards. */
  async converge(what: string, probe: string, params: unknown[], statements: string[]) {
    const read = async () => JSON.stringify((await this.db.query(probe, params)).rows)
    const before = await read()
    await this.all(statements)
    if ((await read()) === before) this.unchanged++
    else this.changed(what)
  }
  async member(role: string, group: string, admin = false) {
    const found = await this.one<{ member: boolean }>(
      admin
        ? `SELECT pg_has_role($1,$2,'MEMBER WITH ADMIN OPTION') AS member`
        : 'SELECT platform.is_member($1,$2) AS member',
      [role, group]
    )
    if (found?.member) return void this.unchanged++
    await this.db.query(membershipStatement({ role: group, member: role, admin }))
    this.changed(admin ? `let ${role} admit others to ${group}` : `add ${role} to ${group}`)
  }
  async describe(target: MetadataTarget, metadata: Record<string, unknown>) {
    const said: string[] = []
    for (const [key, value] of Object.entries(metadata)) {
      // Written once: what an owner has since said of the item is theirs to keep.
      const written = await this.db.query(
        `INSERT INTO platform.item_metadata (scope, schema_name, table_name, column_name, key, value)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (scope, schema_name, coalesce(table_name, ''), coalesce(column_name, ''), key)
         DO NOTHING`,
        [
          target.scope,
          target.schema,
          target.table,
          target.column,
          key,
          JSON.stringify(value ?? null),
        ]
      )
      if (written.rowCount) said.push(key)
      else this.unchanged++
    }
    const item = [target.schema, target.table, target.column].filter(Boolean).join('.')
    if (said.length) this.changed(`describe ${target.scope} ${item}: ${said.join(', ')}`)
  }
}
const notReserved = (role: string) => {
  if (reservedRole(role)) throw new Error(`${role} is a reserved role and is not managed here`)
}

async function applyUser(run: Run, user: User, database: string) {
  notReserved(user.name)
  const role = ident(user.name)
  const found = await run.one<{ login: boolean; connection_limit: number }>(
    'SELECT * FROM platform.role_attributes($1)',
    [user.name]
  )
  if (!found) {
    await run.db.query(createRoleStatements(user)[0]!)
    run.changed(`create user ${user.name}`)
  } else if (found.login !== user.login) {
    await run.db.query(`ALTER ROLE ${role} ${user.login ? 'LOGIN' : 'NOLOGIN'}`)
    run.changed(`${user.login ? 'enable' : 'disable'} login of ${user.name}`)
  } else run.unchanged++
  if (user.connections !== undefined) {
    if ((found?.connection_limit ?? -1) === user.connections) run.unchanged++
    else {
      await run.db.query(`ALTER ROLE ${role} CONNECTION LIMIT ${user.connections}`)
      run.changed(
        user.connections < 0
          ? `lift the connection limit of ${user.name}`
          : `limit ${user.name} to ${user.connections} connections`
      )
    }
  }
  for (const group of ['platform_users', ...user.groups]) await run.member(user.name, group)
  for (const group of user.admits) {
    notReserved(group)
    await run.member(user.name, group, true)
  }
  if (user.admin === undefined) return
  // An administrator makes roles, admits people to the platform and makes workspaces.
  const held = (await run.one<Record<string, boolean>>(
    `SELECT a.create_role AS roles, has_database_privilege(a.name, current_database(), 'CREATE') AS creates,
            platform.has_admin_option(a.name) AS admits
       FROM platform.role_attributes($1) a`,
    [user.name]
  )) ?? { roles: false }
  if (Object.values(held).every((value) => value === user.admin)) run.unchanged++
  else {
    await run.all(
      user.admin
        ? [
            `ALTER ROLE ${role} CREATEROLE`,
            `GRANT platform_users TO ${role} WITH ADMIN OPTION`,
            `GRANT CREATE ON DATABASE ${database} TO ${role}`,
          ]
        : [
            `ALTER ROLE ${role} NOCREATEROLE`,
            `REVOKE ADMIN OPTION FOR platform_users FROM ${role}`,
            `REVOKE CREATE ON DATABASE ${database} FROM ${role}`,
          ]
    )
    run.changed(
      user.admin
        ? `make ${user.name} an administrator`
        : `withdraw administration from ${user.name}`
    )
  }
  if (user.admin) await run.member(user.name, 'platform_admins', true)
  else await run.db.query(`REVOKE platform_admins FROM ${role}`)
}

async function dropRole(run: Run, kind: string, role: string) {
  notReserved(role)
  const found = await run.one<{ r: unknown }>('SELECT to_regrole(quote_ident($1)) AS r', [role])
  if (!found?.r) return void run.unchanged++
  await run.db.query(`DROP ROLE ${ident(role)}`)
  run.changed(`drop ${kind} ${role}`)
}

/** Additive: collections and fields that are missing are made; nothing is altered or dropped. */
async function applyCollections(
  run: Run,
  schema: string,
  collections: Collection[],
  relations: Relation[] = []
) {
  for (const c of collections) {
    const table = ident(schema, c.name)
    const exists = (await run.one<{ t: unknown }>('SELECT to_regclass($1) AS t', [table]))?.t
    if (exists) run.unchanged++
    else {
      await run.all(createCollectionStatements(schema, c.name))
      run.changed(`create collection ${schema}.${c.name}`)
    }
    for (const f of c.fields) {
      const column = await run.one(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`,
        [schema, c.name, f.name]
      )
      if (column) run.unchanged++
      else {
        await run.all(fieldStatements(schema, c.name, fieldSpec(f), false))
        if (exists) run.changed(`add field ${schema}.${c.name}.${f.name}`)
      }
    }
    const held = await run.one<{ note: string | null; secured: boolean }>(
      `SELECT obj_description(oid, 'pg_class') AS note, relrowsecurity AS secured
         FROM pg_class WHERE oid = to_regclass($1)`,
      [table]
    )
    if (c.note !== undefined && (held?.note ?? '') !== c.note.trim()) {
      await run.db.query(commentCollectionStatement(schema, c.name, c.note))
      run.changed(`say what ${schema}.${c.name} is for`)
    }
    if (c.row_security !== undefined && held?.secured !== c.row_security) {
      await run.db.query(rowSecurityStatement(schema, c.name, c.row_security))
      run.changed(`${c.row_security ? 'ask' : 'stop asking'} ${schema}.${c.name} for row policies`)
    }
    await run.describe(collectionTarget(schema, c.name), c.metadata)
    for (const f of c.fields) await run.describe(fieldTarget(schema, c.name, f.name), f.metadata)
  }
  const all = [
    ...relations,
    ...collections.flatMap((c) =>
      c.fields.flatMap((f) =>
        f.relation
          ? [
              {
                collection: c.name,
                field: f.name,
                related: f.relation.collection,
                on_delete: f.relation.on_delete,
              },
            ]
          : []
      )
    ),
  ]
  for (const r of all as Relation[]) {
    const found = await run.one(
      `SELECT 1 FROM pg_constraint con
         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
        WHERE con.contype = 'f' AND con.conrelid = to_regclass($1) AND a.attname = $2`,
      [ident(schema, r.collection), r.field]
    )
    if (found) run.unchanged++
    else {
      await run.db.query(
        relationStatement(schema, r.collection, r.field, r.related, r.on_delete ?? r.onDelete)
      )
      run.changed(`relate ${schema}.${r.collection}.${r.field} to ${r.related}`)
    }
  }
}

async function applyWorkspace(run: Run, w: Workspace) {
  const owner = (
    await run.one<{ owner: string }>(
      'SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname=$1',
      [w.slug]
    )
  )?.owner
  if (owner && w.owner && owner !== w.owner)
    throw new Error(`Workspace ${w.slug} is owned by ${owner}, not ${w.owner}`)
  if (w.owner) await run.member(w.owner, 'platform_users')
  if (owner) run.unchanged++
  else {
    await run.db.query(schemaStatement(w.slug, w.owner))
    run.changed(`create workspace ${w.slug}${w.owner ? ` owned by ${w.owner}` : ''}`)
  }
  // Everything inside a workspace is made as its owner, so the owner owns it.
  if (w.owner) await run.db.query(`SET LOCAL ROLE ${ident(w.owner)}`)
  await run.describe(workspaceTarget(w.slug), w.metadata)
  await applyCollections(run, w.slug, w.collections, w.relations)
  for (const grant of w.grants) {
    const on = grant.collection ? `${w.slug}.${grant.collection}` : `workspace ${w.slug}`
    const allowed = (grant.collection ? tablePrivileges : schemaPrivileges) as readonly string[]
    const wrong = grant.privileges.filter((p) => p !== 'all' && !allowed.includes(p.toUpperCase()))
    if (wrong.length) throw new Error(`${wrong.join(', ')} cannot be granted on ${on}`)
    if (grant.columns && !grant.collection)
      throw new Error(`Columns need a collection: grant on ${on}`)
    const sql = grantStatement(
      {
        schema: w.slug,
        table: grant.collection ?? null,
        privileges: grant.privileges,
        columns: grant.columns,
        grantee: grant.to,
      },
      grant.state === 'absent'
    )
    await run.converge(
      sql.replace(/;$/, ''),
      grant.collection
        ? `SELECT c.relacl::text AS acl, ARRAY(SELECT a.attacl::text FROM pg_attribute a
             WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns
             FROM pg_class c WHERE c.oid=to_regclass($1)`
        : 'SELECT nspacl::text AS acl FROM pg_namespace WHERE nspname=$1',
      [grant.collection ? ident(w.slug, grant.collection) : w.slug],
      [sql]
    )
  }
  for (const policy of w.policies) {
    const statements = [dropPolicyStatement(w.slug, policy.collection, policy.name)]
    if (policy.state === 'present')
      statements.push(
        policyStatement({
          schema: w.slug,
          table: policy.collection,
          name: policy.name,
          permissive: !policy.restrictive,
          command: policy.for.toUpperCase() as PolicyCommand,
          roles: policy.to,
          using: policy.using ?? '',
          check: policy.check ?? '',
        })
      )
    await run.converge(
      `${policy.state === 'present' ? 'set' : 'drop'} policy ${policy.name} on ${w.slug}.${policy.collection}`,
      `SELECT permissive,roles::text,cmd,qual,with_check FROM pg_policies
        WHERE schemaname=$1 AND tablename=$2 AND policyname=$3`,
      [w.slug, policy.collection, policy.name],
      statements
    )
  }
  if (w.owner) await run.db.query('RESET ROLE')
}

/** Applies a manifest inside the caller's transaction, as the caller. */
export async function applyManifest(db: Db, raw: unknown, run = new Run(db)): Promise<ApplyResult> {
  const manifest = parseManifest(raw)
  const database = ident((await run.one<{ d: string }>('SELECT current_database() AS d'))!.d)
  const present = <T extends { state: string }>(all: T[]) =>
    all.filter((x) => x.state === 'present')
  const absent = <T extends { state: string }>(all: T[]) => all.filter((x) => x.state === 'absent')
  for (const group of present(manifest.groups)) {
    notReserved(group.name)
    const found = await run.one<{ login: boolean }>('SELECT * FROM platform.role_attributes($1)', [
      group.name,
    ])
    if (found?.login) throw new Error(`${group.name} is a login, not a group`)
    if (found) run.unchanged++
    else {
      await run.db.query(createRoleStatements({ name: group.name, login: false })[0]!)
      run.changed(`create group ${group.name}`)
    }
  }
  for (const user of present(manifest.users)) await applyUser(run, user, database)
  for (const workspace of manifest.workspaces) await applyWorkspace(run, workspace)
  for (const user of absent(manifest.users)) await dropRole(run, 'user', user.name)
  for (const group of absent(manifest.groups)) await dropRole(run, 'group', group.name)
  return run
}

// --------------------------------------------------------------------------- a site folder

/** What a folder's platform.json says it applies: the schema, and the two SQL files beside it. */
export interface Applied {
  models: unknown
  migration?: string
  demo?: string
}
export interface DeploymentVariables {
  admin: string
}
export const deploymentVariables = (
  env: Record<string, string | undefined> = {}
): DeploymentVariables => ({
  admin:
    env.PLATFORM_ADMIN ||
    (env.PLATFORM_DOMAIN ? `admin@${env.PLATFORM_DOMAIN}` : 'admin@example.com'),
})
export const administratorManifest = (admin: string) => ({
  format: 1,
  users: [{ name: admin, admin: true }],
})
export const manifestOf = (applied: Applied, variables = deploymentVariables()): unknown =>
  typeof applied.models === 'function' ? applied.models(variables) : applied.models

/**
 * models (the schema) every time; migration.sql (what a manifest cannot say) every time, and
 * demo.sql (records and their history) the first time — both only beside the server, as its
 * own superuser, with the deployment's variables in `deployment.*` settings.
 */
export async function applyFolder(
  db: Db,
  applied: Applied,
  variables = deploymentVariables()
): Promise<ApplyResult> {
  const models = manifestOf(applied, variables)
  const run = new Run(db)
  const found: string[] = []
  for (const { slug } of parseManifest(models).workspaces)
    if (await run.one('SELECT 1 FROM pg_namespace WHERE nspname = $1', [slug])) found.push(slug)
  await applyManifest(db, models, run)
  if (applied.migration === undefined && applied.demo === undefined) return run
  const me = await run.one<{ superuser: string }>(
    "SELECT current_setting('is_superuser') AS superuser"
  )
  if (me?.superuser !== 'on') {
    run.notes.push(
      "migration.sql and demo.sql were not run: they are the server's own superuser's. Run them beside the server, as `deploy local admin apply k8s --dir=DIR` does."
    )
    return run
  }
  for (const [key, value] of Object.entries(variables))
    await db.query('SELECT set_config($1, $2, true)', [`deployment.${key}`, value])
  if (applied.migration !== undefined) {
    await script(db, applied.migration)
    run.notes.push('migration.sql was run.')
  }
  if (applied.demo === undefined) return run
  if (found.length)
    run.notes.push(
      `demo.sql was not run: ${found.join(' and ')} ${found.length > 1 ? 'were' : 'was'} already there, and records are written once.`
    )
  else {
    await script(db, applied.demo)
    run.changed('write the records and the history of the demonstration')
  }
  return run
}

/** An additive JSON model, applied with the caller's own DDL rights. */
export async function applyModel(db: Db, raw: unknown) {
  const model = z
    .object({
      workspace: z.object({ slug: name }),
      collections: z.array(collectionSchema),
      relations: z.array(relationSchema).default([]),
    })
    .parse(raw)
  const schema = model.workspace.slug
  await requireInstalledVersion(db)
  return transaction(db, async () => {
    await db.query(`CREATE SCHEMA IF NOT EXISTS ${ident(schema)}`)
    await applyCollections(new Run(db), schema, model.collections, model.relations)
    return { schema, collections: model.collections.length }
  })
}
