import type { Db } from '../db.ts'
import { joinsOf } from './joins.ts'
import type {
  Catalog,
  ColumnInfo,
  ConstraintInfo,
  Identity,
  IndexInfo,
  RelationInfo,
  SchemaInfo,
  TableInfo,
  TypeInfo,
} from './types.ts'

/** Who the session is, and what PostgreSQL says they may do with the database itself. */
export async function identity(db: Db): Promise<Identity> {
  return (await db.query<Identity>('SELECT * FROM platform.session')).rows[0]!
}

/**
 * The catalog as the caller may see it. The questions are the platform's views
 * (`migrations/0001_platform.sql`), which ask PostgreSQL's own privilege functions: psql
 * reads the same answers from the same views.
 */
export async function catalog(db: Db): Promise<Catalog> {
  const rows = async <T>(text: string) => (await db.query<T>(text)).rows
  const schemas = await rows<SchemaInfo>(
    `SELECT name, owner, kind, can_create, can_alter, can_grant FROM platform.catalog_schemas ORDER BY kind DESC, name`
  )
  const tables = await rows<TableInfo>('SELECT * FROM platform.catalog_tables ORDER BY 1, 2')
  const visible = new Set(tables.map((t) => `${t.schema}.${t.name}`))
  const inView = async <T extends { schema: string; table: string }>(view: string, order: string) =>
    (await rows<T>(`SELECT * FROM platform.${view} ORDER BY ${order}`)).filter((row) =>
      visible.has(`${row.schema}.${row.table}`)
    )
  const columns = await inView<ColumnInfo>('catalog_columns', '1, 2, position')
  const constraints = await inView<ConstraintInfo>('catalog_constraints', '1, 2, 3')
  const indexes = await inView<IndexInfo>('catalog_indexes', '1, 2, 3')
  // A relation is a foreign key over one column: the column points at one row of another table.
  const relations: RelationInfo[] = constraints
    .filter((c) => c.type === 'f' && c.columns.length === 1 && c.target_table)
    .map((c) => ({
      schema: c.schema,
      table: c.table,
      column: c.columns[0]!,
      target_schema: c.target_schema!,
      target_table: c.target_table!,
      target_column: c.target_column ?? 'id',
      on_delete: c.on_delete ?? 'a',
    }))
  return {
    schemas,
    tables,
    columns,
    relations,
    constraints,
    types: await rows<TypeInfo>('SELECT * FROM platform.catalog_types ORDER BY 1, 2'),
    indexes,
    joins: joinsOf(relations, indexes, columns),
  }
}
