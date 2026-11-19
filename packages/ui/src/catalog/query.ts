import type { Db } from '../pg/connect.ts'
import type { Catalog } from './types.ts'

/**
 * The catalog: what PostgreSQL holds, read with PostgreSQL's own privilege functions. Every
 * answer is the reader's own, and none of it is cached: the catalog is read again whenever
 * something may have changed.
 */

const notPlatform = `n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname NOT IN ('information_schema','platform','public')`

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
           a.attgenerated::text AS generated, a.attidentity::text AS identity,
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
  // The types the installation holds outside PostgreSQL's own: an extension's, or its own.
  // A table's own row type is not one of them: typrelid names the table it belongs to.
  const types = await db.query(`
    SELECT n.nspname::text AS schema, t.typname::text AS bare,
           n.nspname || '.' || t.typname AS name, t.typtype::text AS kind,
           format_type(t.oid, NULL) AS label
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE t.typtype IN ('b','c','d','e','r','m')
       AND t.typrelid = 0
       AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
       AND has_schema_privilege(n.oid, 'USAGE')
       AND NOT EXISTS (SELECT 1 FROM pg_type e WHERE e.oid = t.typelem AND e.typarray = t.oid)
     ORDER BY 1, 2`)
  const visible = new Set(tables.rows.map((t) => `${t.schema}.${t.name}`))
  const inView = <T extends { schema: unknown; table: unknown }>(rows: T[]) =>
    rows.filter((row) => visible.has(`${row.schema}.${row.table}`))
  return {
    schemas: schemas.rows as unknown as Catalog['schemas'],
    tables: tables.rows as unknown as Catalog['tables'],
    columns: inView(columns.rows as never) as Catalog['columns'],
    relations: inView(relations.rows as never) as Catalog['relations'],
    constraints: inView(constraints.rows as never) as Catalog['constraints'],
    types: types.rows as unknown as Catalog['types'],
  }
}
