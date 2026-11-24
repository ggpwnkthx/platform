import { beforeAll, describe, expect, test } from 'bun:test'
import {
  catalog,
  choicesOf,
  collectionStatements,
  columnsOf,
  fieldMetadata,
  grants,
  grantStatement,
  identity,
  indexFields,
  policies,
  reach,
  roles,
  sqlState,
  transaction,
  unchanged,
} from '../src/index.ts'
import { admin, world } from './world.ts'

let w: Awaited<ReturnType<typeof world>>
beforeAll(async () => {
  w = await world()
})
const refused = async (work: Promise<unknown>) =>
  sqlState(
    await work.then(
      () => null,
      (e) => e
    )
  )

describe('access', () => {
  test('roles, grants, reach and policies are read from PostgreSQL', async () => {
    const db = await w.as(admin)
    const seen = await roles(db)
    expect(seen.roles.map((r) => r.name)).toContain('newsroom_writer')
    expect(seen.memberships).toContainEqual(
      expect.objectContaining({ role: 'sales', member: 'bob@example.com' })
    )
    const acl = await grants(db, 'newsroom')
    expect(acl).toContainEqual(
      expect.objectContaining({
        table: 'articles',
        column: 'title',
        grantee: 'newsroom_writer',
        privilege: 'UPDATE',
      })
    )
    expect(acl).toContainEqual(
      expect.objectContaining({ table: null, grantee: 'newsroom_reader', privilege: 'USAGE' })
    )
    const held = await reach(db, 'newsroom', { role: 'alice@example.com', table: 'articles' })
    expect(held[0]).toMatchObject({
      usage: true,
      select: 'some',
      update: 'some',
      delete: true,
      truncate: false,
    })
    const rules = await policies(await w.as('alice@example.com'), 'newsroom', 'articles')
    expect(rules.map((p) => p.name)).toEqual(['own_articles', 'published_articles'])
    expect(rules.every((p) => p.applies)).toBe(true)
  })

  test('who may grant and admit is PostgreSQL’s answer, and a grant that changes nothing is refused', async () => {
    const root = await w.as(admin)
    await root.query('GRANT SELECT ON newsroom.sections TO "alice@example.com" WITH GRANT OPTION')
    expect((await identity(root)).admits).toContain('newsroom_writer')
    const db = await w.as('alice@example.com')
    expect((await identity(db)).admits).toEqual([])
    const seen = await catalog(db)
    const may = (name: string) => seen.tables.find((t) => t.name === name)?.can_grant
    expect([may('sections'), may('articles')]).toEqual([true, false])
    expect(seen.schemas.find((s) => s.name === 'newsroom')?.can_grant).toBe(false)
    const grant = (table: string) =>
      db.query(
        grantStatement({
          schema: 'newsroom',
          table,
          privileges: ['SELECT'],
          grantee: 'bob@example.com',
        })
      )
    // Held WITH GRANT OPTION, the grant is made. Without it PostgreSQL only warns (01007).
    expect(() => grant('sections').then(unchanged)).not.toThrow()
    const warned = await grant('articles')
    expect(warned.notices?.[0]).toMatchObject({ severity: 'WARNING', code: '01007' })
    expect(() => unchanged(warned)).toThrow('no privileges were granted')
  })

  test('only others see the whole role graph when they are operators', async () => {
    const seen = await roles(await w.as('alice@example.com'))
    expect(seen.roles.map((r) => r.name)).not.toContain('sales')
    expect(seen.memberships.every((m) => m.member === 'alice@example.com')).toBe(true)
  })
})

describe('the model and its metadata', () => {
  test('a collection is made with statements shown first, as its owner', async () => {
    const db = await w.as('bob@example.com')
    const statements = collectionStatements('crm', 'visits', 'Who we went to see.', [
      {
        name: 'account',
        type: 'relation',
        relation: 'accounts',
        onDelete: 'cascade',
        required: true,
      },
      {
        name: 'kind',
        type: 'text',
        choices: ['call', "on site's"],
        default: 'call',
        indexed: true,
      },
      { name: 'minutes', type: 'integer', min: 0, max: 600 },
      {
        name: 'place',
        type: 'text',
        maxLength: 80,
        views: { list: 'hide' },
        renderers: { list: 'truncate' },
      },
    ])
    expect(statements[0]).toBe(`SELECT platform.create_collection('crm', 'visits');`)
    await transaction(db, async () => {
      for (const statement of statements) await db.query(statement)
    })
    const cat = await catalog(db)
    expect(columnsOf(cat, 'crm', 'visits').map((c) => c.name)).toEqual([
      'id',
      'created_at',
      'updated_at',
      'created_by',
      'updated_by',
      'version',
      'account',
      'kind',
      'minutes',
      'place',
    ])
    expect(choicesOf(cat, 'crm', 'visits', 'kind')).toEqual(['call', "on site's"])
    expect(cat.relations).toContainEqual(
      expect.objectContaining({
        table: 'visits',
        column: 'account',
        target_table: 'accounts',
        on_delete: 'c',
      })
    )
    const said = indexFields(await fieldMetadata(db, 'crm', 'visits'))
    expect(said.place?.views).toMatchObject({ list: 'hide', record: 'show' })
    expect(said.place?.renderers).toEqual({ list: { renderer: 'truncate', options: {} } })
    // A field that says nothing appears everywhere: only what narrows that is written.
    expect(said.id?.views).toBeUndefined()
    // New collections have row security and no policies: a grant alone shows no row.
    expect(cat.tables.find((t) => t.name === 'visits')).toMatchObject({
      rls: true,
      owner: 'bob@example.com',
    })
  })

  test('metadata is read by who reaches the item and written by its owner alone', async () => {
    const alice = await w.as('alice@example.com')
    const labels = indexFields(await fieldMetadata(alice, 'newsroom', 'articles'))
    expect(labels.title?.label).toBe('Headline')
    expect(labels.internal_notes).toBeUndefined()
    expect(
      await refused(
        alice.query(
          `INSERT INTO platform.item_metadata (scope, schema_name, key, value) VALUES ('workspace','newsroom','x','1')`
        )
      )
    ).toBe('42501')
  })
})
