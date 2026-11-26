import { beforeAll, describe, expect, test } from 'bun:test'
import {
  carried,
  columnDefaultStatement,
  columnTypeStatement,
  type Db,
  dropSchemaStatement,
  exclusionStatement,
  foreignKeyStatement,
  indexDraftStatement,
  itemMetadata,
  renameColumnStatement,
  renameConstraintStatement,
  renameRoleStatement,
  renameSchemaStatement,
  renameTableStatement,
  roleAttributesStatement,
  schemaOwnerStatement,
  transaction,
  validateConstraintStatement,
} from '../src/index.ts'
import { admin, world } from './world.ts'

let w: Awaited<ReturnType<typeof world>>
beforeAll(async () => {
  w = await world()
})
const run = async (db: Db, statements: string[]) =>
  transaction(db, async () => {
    for (const statement of statements) await db.query(statement)
  })
const keys = async (db: Db, schema: string, table?: string) =>
  (await itemMetadata(db, schema, table)).map(
    (r) => `${r.scope}:${r.schema_name}.${r.table_name ?? ''}.${r.column_name ?? ''}:${r.key}`
  )

describe('what changes a thing that is there', () => {
  test('a renamed table keeps what its owner said of it and of its columns', async () => {
    const db = await w.as(admin)
    const said = await itemMetadata(db, 'newsroom', 'sections')
    expect(said.length).toBeGreaterThan(0)
    await run(
      db,
      carried(
        said,
        { schema: 'newsroom', table: 'sections' },
        { schema: 'newsroom', table: 'desks' },
        renameTableStatement('newsroom', 'sections', 'desks')
      )
    )
    expect(await keys(db, 'newsroom', 'sections')).toEqual([])
    expect(await keys(db, 'newsroom', 'desks')).toContain('column:newsroom.desks.name:renderers')
    expect(await keys(db, 'newsroom', 'desks')).toContain('table:newsroom.desks.:display_name')
  })
  test('a renamed column keeps its sayings, and its rules follow it', async () => {
    const db = await w.as(admin)
    const said = (await itemMetadata(db, 'newsroom', 'desks')).filter(
      (r) => r.column_name === 'name'
    )
    await run(
      db,
      carried(
        said,
        { schema: 'newsroom', table: 'desks', column: 'name' },
        { schema: 'newsroom', table: 'desks', column: 'title' },
        renameColumnStatement('newsroom', 'desks', 'name', 'title')
      )
    )
    expect(await keys(db, 'newsroom', 'desks')).toContain('column:newsroom.desks.title:renderers')
    expect(() => renameColumnStatement('newsroom', 'desks', 'id', 'key')).toThrow()
  })
  test('a column takes a new type and a new default', async () => {
    const db = await w.as(admin)
    await run(db, [
      columnTypeStatement('newsroom', 'articles', 'word_count', 'bigint'),
      columnTypeStatement('newsroom', 'desks', 'desk_email', 'varchar(200)', 'lower(desk_email)'),
      columnDefaultStatement('newsroom', 'articles', 'word_count', '0'),
      columnDefaultStatement('newsroom', 'articles', 'status', ''),
    ])
    const columns = await db.query<{ name: string; type: string; default: string | null }>(
      `SELECT name, type, "default" FROM platform.catalog_columns
        WHERE schema = 'newsroom' AND name IN ('word_count', 'status', 'desk_email') ORDER BY name`
    )
    expect(columns.rows).toEqual([
      { name: 'desk_email', type: 'character varying(200)', default: null },
      { name: 'status', type: 'text', default: null },
      { name: 'word_count', type: 'bigint', default: '0' },
    ])
  })
  test('keys and indexes take the options PostgreSQL has', async () => {
    const db = await w.as(admin)
    await run(db, [
      foreignKeyStatement(
        'newsroom',
        'articles',
        'section',
        { schema: 'newsroom', table: 'desks' },
        'set_null',
        'articles_desk_fkey',
        {
          onUpdate: 'cascade',
          deferrable: true,
          notValid: true,
        }
      ),
      indexDraftStatement('newsroom', 'articles', {
        expressions: ['lower(title)'],
        method: 'btree',
        include: ['status'],
        where: "status <> 'draft'",
        name: 'articles_title_lower_idx',
      }),
      indexDraftStatement('newsroom', 'articles', { columns: ['title'], method: 'hash' }),
      exclusionStatement(
        'newsroom',
        'articles',
        'USING btree (title WITH =)',
        'articles_one_title'
      ),
    ])
    const held = await db.query<{ name: string; validated: boolean; on_update: string }>(
      `SELECT name, validated, on_update FROM platform.catalog_constraints WHERE name = 'articles_desk_fkey'`
    )
    expect(held.rows[0]).toEqual({ name: 'articles_desk_fkey', validated: false, on_update: 'c' })
    await run(db, [
      validateConstraintStatement('newsroom', 'articles', 'articles_desk_fkey'),
      renameConstraintStatement(
        'newsroom',
        'articles',
        'articles_desk_fkey',
        'articles_section_fkey2'
      ),
    ])
    const defs = await db.query<{ name: string; definition: string }>(
      `SELECT name, definition FROM platform.catalog_index_definitions WHERE "table" = 'articles' ORDER BY name`
    )
    const partial = defs.rows.find((d) => d.name === 'articles_title_lower_idx')!
    expect(partial.definition).toContain('INCLUDE (status)')
    expect(partial.definition).toContain('WHERE')
    expect(defs.rows.some((d) => d.definition.includes('USING hash'))).toBe(true)
  })
  test('a schema is renamed with its sayings, handed over, and dropped once empty', async () => {
    const db = await w.as(admin)
    const said = await itemMetadata(db, 'newsroom')
    await run(
      db,
      carried(
        said,
        { schema: 'newsroom' },
        { schema: 'press' },
        renameSchemaStatement('newsroom', 'press')
      )
    )
    expect(await keys(db, 'press')).toContain('schema:press..:display_name')
    expect(await keys(db, 'newsroom')).toEqual([])
    await run(db, ['CREATE SCHEMA scratch;', schemaOwnerStatement('scratch', 'newsroom_writer')])
    await run(db, [dropSchemaStatement('scratch')])
    await expect(run(db, [dropSchemaStatement('press')])).rejects.toThrow()
  })
  test('an operator changes a role’s attributes and its name', async () => {
    const db = await w.as(admin)
    const held = { login: true, create_role: false, inherit: true, connection_limit: -1 }
    await run(db, ['CREATE ROLE "carol@example.com" LOGIN;'])
    const statement = roleAttributesStatement('carol@example.com', held, {
      ...held,
      login: false,
      connection_limit: 3,
    })
    expect(statement).toBe('ALTER ROLE "carol@example.com" WITH NOLOGIN CONNECTION LIMIT 3;')
    expect(roleAttributesStatement('carol@example.com', held, held)).toBeNull()
    await run(db, [statement!, renameRoleStatement('newsroom_reader', 'readers')])
    // Without ADMIN OPTION on a role, PostgreSQL refuses to alter it.
    await expect(
      run(db, [roleAttributesStatement('bob@example.com', held, { ...held, login: false })!])
    ).rejects.toThrow('permission denied')
    const role = await db.query<{ connection_limit: number; login: boolean }>(
      `SELECT login, connection_limit FROM platform.visible_roles() WHERE name = 'carol@example.com'`
    )
    expect(role.rows[0]).toEqual({ login: false, connection_limit: 3 })
  })
})
