import type { Db } from './connect.ts'
import { conditionClause, type Filter } from './filter.ts'
import { ident, qualified } from '@platform/sql'
import type {
  ActivityInfo,
  Catalog,
  GrantInfo,
  Identity,
  MembershipInfo,
  MetadataEntry,
  PolicyInfo,
  RoleInfo,
  SchemaGrantInfo,
} from './types.ts'

/**
 * Everything the interface reads and writes, as the statements PostgreSQL runs. Each one runs
 * on the reader's own login, so nothing here decides a right: the catalog questions ask
 * PostgreSQL's privilege functions, and every write is judged by PostgreSQL when it runs.
 */

const notPlatform = `n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname NOT IN ('information_schema','platform','public')`

export async function identity(db: Db): Promise<Identity> {
  const result = await db.query<Identity>(`
    SELECT session_user::text AS username, current_user::text AS effective_role,
           current_database()::text AS database,
           (SELECT version FROM platform.installation) AS platform_version,
           current_setting('server_version') AS server_version,
           has_database_privilege(current_database(), 'CREATE') AS can_create_workspace,
           platform.is_operator() AS is_operator`)
  return result.rows[0]!
}

export async function catalog(db: Db): Promise<Catalog> {
  const schemas = await db.query(`
    SELECT n.nspname::text AS name, pg_get_userbyid(n.nspowner)::text AS owner,
           has_schema_privilege(n.oid, 'CREATE') AS can_create,
           pg_has_role(current_user, n.nspowner, 'USAGE') AS can_alter
      FROM pg_namespace n
     WHERE ${notPlatform} AND has_schema_privilege(n.oid, 'USAGE') ORDER BY 1`)
  const tables = await db.query(`
    SELECT n.nspname::text AS schema, c.relname::text AS name, c.relkind::text AS kind,
           c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
           pg_get_userbyid(c.relowner)::text AS owner, obj_description(c.oid, 'pg_class') AS comment,
           has_table_privilege(c.oid, 'SELECT') AS can_select,
           has_table_privilege(c.oid, 'INSERT') AS can_insert,
           has_table_privilege(c.oid, 'UPDATE') AS can_update,
           has_table_privilege(c.oid, 'DELETE') AS can_delete,
           has_table_privilege(c.oid, 'TRUNCATE') AS can_truncate,
           pg_has_role(current_user, c.relowner, 'USAGE') AS can_alter
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p','v') AND ${notPlatform} AND has_schema_privilege(n.oid, 'USAGE')
       AND (has_any_column_privilege(c.oid, 'SELECT,INSERT,UPDATE')
            OR has_table_privilege(c.oid, 'DELETE,TRUNCATE')
            OR pg_has_role(current_user, c.relowner, 'USAGE'))
     ORDER BY 1, 2`)
  const columns = await db.query(`
    SELECT n.nspname::text AS schema, c.relname::text AS table, a.attname::text AS name,
           a.attnum::int AS position, format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS required, pg_get_expr(d.adbin, d.adrelid) AS "default",
           col_description(c.oid, a.attnum) AS comment,
           has_column_privilege(c.oid, a.attnum, 'SELECT') AS can_select,
           has_column_privilege(c.oid, a.attnum, 'INSERT') AS can_insert,
           has_column_privilege(c.oid, a.attnum, 'UPDATE') AS can_update
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v')
       AND ${notPlatform} AND has_schema_privilege(n.oid, 'USAGE')
     ORDER BY 1, 2, a.attnum`)
  const relations = await db.query(`
    SELECT n.nspname::text AS schema, c.relname::text AS table, a.attname::text AS column,
           rn.nspname::text AS target_schema, rc.relname::text AS target_table,
           con.confdeltype::text AS on_delete
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class rc ON rc.oid = con.confrelid JOIN pg_namespace rn ON rn.oid = rc.relnamespace
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND ${notPlatform} AND has_schema_privilege(n.oid, 'USAGE')
     ORDER BY 1, 2, 3`)
  const constraints = await db.query(`
    SELECT n.nspname::text AS schema, c.relname::text AS table, con.conname::text AS name,
           con.contype::text AS type, pg_get_constraintdef(con.oid) AS definition,
           ARRAY(SELECT a.attname::text FROM pg_attribute a
                  WHERE a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)) AS columns
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE ${notPlatform} AND has_schema_privilege(n.oid, 'USAGE') AND con.contype IN ('c','u','p','f','x')
     ORDER BY 1, 2, 3`)
  const visible = new Set(tables.rows.map((t) => `${t.schema}.${t.name}`))
  const inView = <T extends { schema: unknown; table: unknown }>(rows: T[]) =>
    rows.filter((row) => visible.has(`${row.schema}.${row.table}`))
  return {
    schemas: schemas.rows as unknown as Catalog['schemas'],
    tables: tables.rows as unknown as Catalog['tables'],
    columns: inView(columns.rows as never) as Catalog['columns'],
    relations: inView(relations.rows as never) as Catalog['relations'],
    constraints: inView(constraints.rows as never) as Catalog['constraints'],
  }
}

/** The roles and memberships the reader may see, through the platform's own functions. */
export async function roles(db: Db): Promise<{ roles: RoleInfo[]; memberships: MembershipInfo[] }> {
  const found = await db.query<RoleInfo>(`
    SELECT r.*,
      (platform.is_operator()
       OR EXISTS (SELECT 1 FROM platform.visible_memberships() m
                   WHERE m.role = r.name AND m.member = session_user AND m.admin_option)
       OR (coalesce((SELECT create_role FROM platform.role_attributes(session_user)), false)
           AND NOT r.superuser)) AS admits
      FROM platform.visible_roles() r`)
  const memberships = await db.query<MembershipInfo>('SELECT * FROM platform.visible_memberships()')
  return { roles: found.rows, memberships: memberships.rows }
}

export async function policies(db: Db): Promise<PolicyInfo[]> {
  const result = await db.query<PolicyInfo>(`
    SELECT schemaname::text AS schema, tablename::text AS table, policyname::text AS name,
           permissive, roles::text[] AS roles, cmd AS command, qual AS using, with_check AS check
      FROM pg_policies
     WHERE schemaname NOT IN ('platform')
     ORDER BY 1, 2, 3`)
  return result.rows
}

/** The grants on the tables and columns of one workspace, read from their ACLs. */
export async function grants(db: Db, schema: string): Promise<GrantInfo[]> {
  const result = await db.query<GrantInfo>(
    `
    SELECT n.nspname::text AS schema, c.relname::text AS table, NULL::text AS column,
           CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee)::text END AS grantee,
           g.privilege_type::text AS privilege, pg_get_userbyid(g.grantor)::text AS grantor,
           g.is_grantable AS grantable
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
           LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) g
     WHERE n.nspname = $1 AND c.relkind IN ('r','p','v')
    UNION ALL
    SELECT n.nspname::text, c.relname::text, a.attname::text,
           CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee)::text END,
           g.privilege_type::text, pg_get_userbyid(g.grantor)::text, g.is_grantable
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace,
           LATERAL aclexplode(a.attacl) g
     WHERE n.nspname = $1 AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
     ORDER BY 2, 3 NULLS FIRST, 4, 5`,
    [schema]
  )
  return result.rows
}

export async function schemaGrants(db: Db, schema: string): Promise<SchemaGrantInfo[]> {
  const result = await db.query<SchemaGrantInfo>(
    `
    SELECT n.nspname::text AS schema,
           CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee)::text END AS grantee,
           g.privilege_type::text AS privilege, g.is_grantable AS grantable
      FROM pg_namespace n, LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) g
     WHERE n.nspname = $1 ORDER BY 2, 3`,
    [schema]
  )
  return result.rows
}

export interface ActivityQuery {
  schema: string
  table?: string
  /** A row's id: its revisions only. */
  row?: string
  before?: number
  limit?: number
}

/** Revisions the reader may read: row security shows a workspace's owners its full history. */
export async function activity(db: Db, query: ActivityQuery): Promise<ActivityInfo[]> {
  const values: unknown[] = [query.schema]
  const where = ['schema_name = $1']
  if (query.table) {
    values.push(query.table)
    where.push(`table_name = $${values.length}`)
  }
  if (query.row) {
    values.push(query.row)
    where.push(`(after_row->>'id' = $${values.length} OR before_row->>'id' = $${values.length})`)
  }
  if (query.before) {
    values.push(query.before)
    where.push(`id < $${values.length}`)
  }
  values.push(Math.min(query.limit ?? 100, 500))
  const result = await db.query<ActivityInfo>(
    `SELECT id, at::text AS at, transaction_id, actor, schema_name, table_name, operation,
            before_row, after_row
       FROM platform.activity WHERE ${where.join(' AND ')}
      ORDER BY id DESC LIMIT $${values.length}`,
    values
  )
  return result.rows
}

export interface RecordQuery {
  schema: string
  table: string
  /** The columns to read; the readable ones when absent. */
  columns: string[]
  /** Every readable column: the search reads them all, not only those on screen. */
  searchable: string[]
  filter: Filter
  search: string
  /** Column names; a leading minus sorts descending. */
  sort: string[]
  limit: number
  offset: number
}

export interface Predicate {
  sql: string
  values: unknown[]
}

/**
 * The WHERE clause of a record query: the filter's conditions, then the search. Every value is
 * bound and every column quoted, so a query can never change the shape of the statement.
 */
export function predicate(
  filter: Filter,
  search: string,
  searchable: readonly string[]
): Predicate {
  const values: unknown[] = []
  const clauses: string[] = []
  for (const [column, condition] of Object.entries(filter)) {
    const clause = conditionClause(ident(column), condition)
    if (!clause.values.length && clause.sql === 'TRUE') continue
    const offset = values.length
    clauses.push(clause.sql.replace(/\$(\d+)/g, (_, i: string) => `$${offset + Number(i)}`))
    values.push(
      ...clause.values.map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v))
    )
  }
  if (search.trim() && searchable.length) {
    values.push(`%${search.trim().replace(/([\\%_])/g, '\\$1')}%`)
    const matched = searchable.map(
      (column) => `CAST(${ident(column)} AS TEXT) ILIKE $${values.length} ESCAPE '\\'`
    )
    clauses.push(`(${matched.join(' OR ')})`)
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values }
}

/** One page of rows, and the number of rows the predicate allows under row security. */
export async function records(db: Db, query: RecordQuery) {
  const target = qualified(query.schema, query.table)
  const where = predicate(query.filter, query.search, query.searchable)
  const order = query.sort.map(
    (name) => `${ident(name.replace(/^-/, ''))} ${name.startsWith('-') ? 'DESC' : 'ASC'} NULLS LAST`
  )
  const values = [...where.values, query.limit, query.offset]
  const rows = await db.query(
    `SELECT ${query.columns.map(ident).join(', ')} FROM ${target} ${where.sql}
     ${order.length ? `ORDER BY ${order.join(', ')}` : ''}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  )
  const counted = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM ${target} ${where.sql}`,
    where.values
  )
  return { rows: rows.rows, fields: rows.fields, total: counted.rows[0]?.total ?? 0 }
}

/** One row, by id, with the columns the reader may read. */
export async function record(db: Db, schema: string, table: string, columns: string[], id: string) {
  const result = await db.query(
    `SELECT ${columns.map(ident).join(', ')} FROM ${qualified(schema, table)} WHERE id = $1`,
    [id]
  )
  return result.rows[0] ?? null
}

/**
 * Writes a row. No RETURNING: the right to insert or update a column is not a right to read
 * it back, so a write reports how many rows it touched and nothing else.
 */
export async function insertRecord(
  db: Db,
  schema: string,
  table: string,
  values: Record<string, unknown>
) {
  const entries = Object.entries(values)
  const sql = entries.length
    ? `INSERT INTO ${qualified(schema, table)} (${entries.map(([k]) => ident(k)).join(', ')})
       VALUES (${entries.map((_, i) => `$${i + 1}`).join(', ')})`
    : `INSERT INTO ${qualified(schema, table)} DEFAULT VALUES`
  return (
    (
      await db.query(
        sql,
        entries.map(([, v]) => v)
      )
    ).affected ?? 0
  )
}

/** Changes a row, only if it still carries the version the reader saw. */
export async function updateRecord(
  db: Db,
  schema: string,
  table: string,
  id: string,
  values: Record<string, unknown>,
  version?: number
) {
  const entries = Object.entries(values)
  if (!entries.length) return 0
  const params: unknown[] = entries.map(([, v]) => v)
  params.push(id)
  let sql = `UPDATE ${qualified(schema, table)} SET ${entries
    .map(([k], i) => `${ident(k)} = $${i + 1}`)
    .join(', ')} WHERE id = $${params.length}`
  if (version !== undefined) {
    params.push(version)
    sql += ` AND version = $${params.length}`
  }
  return (await db.query(sql, params)).affected ?? 0
}

export async function deleteRecord(
  db: Db,
  schema: string,
  table: string,
  id: string,
  version?: number
) {
  const params: unknown[] = [id]
  let sql = `DELETE FROM ${qualified(schema, table)} WHERE id = $1`
  if (version !== undefined) {
    params.push(version)
    sql += ' AND version = $2'
  }
  return (await db.query(sql, params)).affected ?? 0
}

/** The options a relation offers: rows of the target, labelled by their first text column. */
export async function relationOptions(
  db: Db,
  schema: string,
  table: string,
  label: string | null,
  search: string
) {
  const shown = label ? `CAST(${ident(label)} AS TEXT)` : 'id::text'
  const result = await db.query<{ id: string; label: string }>(
    `SELECT id::text AS id, ${shown} AS label FROM ${qualified(schema, table)}
      WHERE $1 = '' OR ${shown} ILIKE '%' || $1 || '%' OR id::text = $1
      ORDER BY 2 LIMIT 20`,
    [search.trim()]
  )
  return result.rows
}

/** Runs the reader's own statement: one statement, as them. */
export async function run(db: Db, sql: string) {
  return db.query(sql)
}

export async function metadata(db: Db, schema: string, table: string | null) {
  const result = await db.query<MetadataEntry>(
    `SELECT key, value, version::int AS version, updated_at::text AS updated_at, updated_by
       FROM platform.item_metadata
      WHERE scope = $1 AND schema_name = $2 AND table_name IS NOT DISTINCT FROM $3::text
      ORDER BY key`,
    [table === null ? 'workspace' : 'collection', schema, table]
  )
  return result.rows
}

/** Sets one key; with a version, only if the key still carries it. */
export async function setMetadata(
  db: Db,
  schema: string,
  table: string | null,
  key: string,
  value: unknown,
  version?: number
) {
  const params: unknown[] = [
    table === null ? 'workspace' : 'collection',
    schema,
    table,
    key,
    JSON.stringify(value === undefined ? null : value),
  ]
  const sql =
    version === undefined
      ? `INSERT INTO platform.item_metadata (scope, schema_name, table_name, key, value)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (scope, schema_name, coalesce(table_name, ''), key)
         DO UPDATE SET value = EXCLUDED.value`
      : `UPDATE platform.item_metadata SET value = $5::jsonb
          WHERE scope = $1 AND schema_name = $2 AND table_name IS NOT DISTINCT FROM $3::text
            AND key = $4 AND version = $6`
  if (version !== undefined) params.push(version)
  return (await db.query(sql, params)).affected ?? 0
}

export async function removeMetadata(db: Db, schema: string, table: string | null, key: string) {
  const result = await db.query(
    `DELETE FROM platform.item_metadata
      WHERE scope = $1 AND schema_name = $2 AND table_name IS NOT DISTINCT FROM $3::text AND key = $4`,
    [table === null ? 'workspace' : 'collection', schema, table, key]
  )
  return result.affected ?? 0
}

/** Runs statements as one transaction: all of them happen, or none. */
export async function transaction<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  await db.query('BEGIN')
  try {
    const result = await fn()
    await db.query('COMMIT')
    return result
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}
