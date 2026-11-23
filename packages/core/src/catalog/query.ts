import type { Db } from '../db.ts'
import {
  type Catalog,
  type ColumnInfo,
  type ConstraintInfo,
  type Identity,
  type RelationInfo,
  type SchemaInfo,
  type TableInfo,
  type TypeInfo,
  systemSchema,
} from '../catalog/types.ts'
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

const held = `n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname NOT IN ('information_schema','public')`
const system = `n.nspname = '${systemSchema}'`
const usable = `${held} AND has_schema_privilege(n.oid, 'USAGE')`

/**
 * The catalog as the caller may see it, from PostgreSQL's own privilege functions. The
 * platform's schema is in it as a workspace of another kind, whose model nobody may change.
 */
export async function catalog(db: Db): Promise<Catalog> {
  const rows = async <T>(text: string) => (await db.query<T>(text)).rows
  const schemas = await rows<SchemaInfo>(`
    SELECT n.nspname::text AS name, pg_get_userbyid(n.nspowner)::text AS owner,
           CASE WHEN ${system} THEN 'system' ELSE 'user' END AS kind,
           has_schema_privilege(n.oid, 'CREATE') AND NOT ${system} AS can_create,
           pg_has_role(current_user, n.nspowner, 'USAGE') AND NOT ${system} AS can_alter
      FROM pg_namespace n WHERE ${usable} ORDER BY ${system}, 1`)
  const tables = await rows<TableInfo>(`
    SELECT n.nspname::text AS schema, c.relname::text AS name, c.relkind::text AS kind,
           c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls,
           pg_get_userbyid(c.relowner)::text AS owner, obj_description(c.oid, 'pg_class') AS comment,
           ${system} AS system,
           has_table_privilege(c.oid, 'SELECT') AS can_select,
           has_table_privilege(c.oid, 'INSERT') AS can_insert,
           has_table_privilege(c.oid, 'UPDATE') AS can_update,
           has_table_privilege(c.oid, 'DELETE') AS can_delete,
           has_table_privilege(c.oid, 'TRUNCATE') AND NOT ${system} AS can_truncate,
           pg_has_role(current_user, c.relowner, 'USAGE') AND NOT ${system} AS can_alter
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p','v') AND ${usable}
       AND (has_any_column_privilege(c.oid, 'SELECT,INSERT,UPDATE')
            OR has_table_privilege(c.oid, 'DELETE,TRUNCATE')
            OR pg_has_role(current_user, c.relowner, 'USAGE'))
     ORDER BY 1, 2`)
  const columns = await rows<ColumnInfo>(`
    SELECT n.nspname::text AS schema, c.relname::text AS table, a.attname::text AS name,
           a.attnum::int AS position, format_type(a.atttypid, a.atttypmod) AS type,
           a.attnotnull AS required, pg_get_expr(d.adbin, d.adrelid) AS "default",
           col_description(c.oid, a.attnum) AS comment,
           a.attgenerated::text AS generated, a.attidentity::text AS identity,
           has_column_privilege(c.oid, a.attnum, 'SELECT') AS can_select,
           has_column_privilege(c.oid, a.attnum, 'INSERT') AS can_insert,
           has_column_privilege(c.oid, a.attnum, 'UPDATE') AS can_update
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
     WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v') AND ${usable}
     ORDER BY 1, 2, a.attnum`)
  const relations = await rows<RelationInfo>(`
    SELECT n.nspname::text AS schema, c.relname::text AS table, a.attname::text AS column,
           rn.nspname::text AS target_schema, rc.relname::text AS target_table,
           con.confdeltype::text AS on_delete
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_class rc ON rc.oid = con.confrelid JOIN pg_namespace rn ON rn.oid = rc.relnamespace
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
     WHERE con.contype = 'f' AND ${usable} ORDER BY 1, 2, 3`)
  const constraints = await rows<ConstraintInfo>(`
    SELECT n.nspname::text AS schema, c.relname::text AS table, con.conname::text AS name,
           con.contype::text AS type, pg_get_constraintdef(con.oid) AS definition,
           ARRAY(SELECT a.attname::text FROM pg_attribute a
                  WHERE a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)) AS columns
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE ${usable} AND con.contype IN ('c','u','p','f','x') ORDER BY 1, 2, 3`)
  const types = await rows<TypeInfo>(`
    SELECT n.nspname::text AS schema, t.typname::text AS bare,
           n.nspname || '.' || t.typname AS name, t.typtype::text AS kind,
           format_type(t.oid, NULL) AS label
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typtype IN ('b','c','d','e','r','m') AND t.typrelid = 0
       AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
       AND has_schema_privilege(n.oid, 'USAGE')
       AND NOT EXISTS (SELECT 1 FROM pg_type e WHERE e.oid = t.typelem AND e.typarray = t.oid)
     ORDER BY 1, 2`)
  const visible = new Set(tables.map((t) => `${t.schema}.${t.name}`))
  const inView = <T extends { schema: string; table: string }>(all: T[]) =>
    all.filter((row) => visible.has(`${row.schema}.${row.table}`))
  return {
    schemas,
    tables,
    columns: inView(columns),
    relations: inView(relations),
    constraints: inView(constraints),
    types,
  }
}
