import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { grants, policies, reach, roles, schemaGrants, schemaReach } from '@platform/data'
import {
  draftOf,
  granteesOf,
  groupsOf,
  heldBy,
  reachOf,
  throughOf,
  toggleField,
  wantedOf,
} from '@platform/ui/access/model.ts'
import {
  type DataSource,
  dropPolicyStatement,
  grantChangeStatements,
  policyStatement,
  schemaGrantStatement,
  type Wanted,
} from '@platform/vocabulary'

/**
 * The access pages read PostgreSQL's ACLs and write the difference between what they hold
 * and what is asked for. This asks the real thing — PostgreSQL, installed with the platform's
 * own script and seeded with the example — and runs the statements the pages would show, as
 * the workspace's owner, to see that the ACL ends up saying what was asked.
 */
const text = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

let pg: PGlite
const db: DataSource = {
  query: (async (statement: string, values?: unknown[]) => {
    const result = await pg.query(statement, values as never)
    return { rows: result.rows, affected: result.affectedRows }
  }) as DataSource['query'],
}

const owner = 'admin@example.com'

async function as<T>(role: string, ask: () => Promise<T>): Promise<T> {
  await pg.query(`SET SESSION AUTHORIZATION ${JSON.stringify(role)}`)
  try {
    return await ask()
  } finally {
    await pg.query('SET SESSION AUTHORIZATION postgres')
  }
}

/** What a role holds on a collection, as the ACL records it now. */
const held = async (table: string, grantee: string) =>
  heldBy(await as(owner, () => grants(db, 'newsroom')), table, grantee)

/** Runs the change the editor would show, as the owner, and reads the ACL again. */
async function change(table: string, grantee: string, wanted: Record<string, Wanted>) {
  const statements = grantChangeStatements({
    schema: 'newsroom',
    table,
    grantee,
    held: await held(table, grantee),
    wanted,
  })
  await as(owner, async () => {
    for (const statement of statements) await pg.query(statement)
  })
  return { statements, held: await held(table, grantee) }
}

const fields = [
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'version',
  'title',
  'status',
  'section',
  'word_count',
  'published_at',
  'internal_notes',
]

beforeAll(async () => {
  pg = await PGlite.create()
  await pg.exec(text('../../../migrations/0001_platform.sql'))
  await pg.exec(text('../seed.sql'))
})

describe('what the ACLs of a workspace say', () => {
  test('a collection names the roles it is granted to, its owner apart', async () => {
    const all = await as(owner, () => grants(db, 'newsroom'))
    expect(granteesOf(all, 'articles', owner)).toEqual(['newsroom_reader', 'newsroom_writer'])
    const reader = heldBy(all, 'articles', 'newsroom_reader')
    expect(reader.SELECT?.whole).toBe(false)
    expect(reader.SELECT?.columns).not.toContain('internal_notes')
    expect(reader.SELECT?.columns).toHaveLength(11)
    expect(heldBy(all, 'articles', 'newsroom_writer').DELETE).toEqual({ whole: true, columns: [] })
  })

  test('a reader who owns nothing reads the same ACLs', async () => {
    const all = await as('alice@example.com', () => grants(db, 'newsroom'))
    expect(granteesOf(all, 'sections', owner)).toEqual(['newsroom_reader'])
  })
})

describe('what PostgreSQL answers for a role', () => {
  test('a member reaches what its groups are granted, and the answer says through whom', async () => {
    const answers = await as(owner, () => reach(db, 'newsroom', { role: 'alice@example.com' }))
    const articles = answers.find((row) => row.table === 'articles')!
    expect(articles.usage).toBe(true)
    expect(reachOf(articles, 'SELECT')).toBe('some')
    expect(reachOf(articles, 'DELETE')).toBe('all')
    expect(reachOf(articles, 'TRUNCATE')).toBe('none')
    const { memberships } = await as(owner, () => roles(db))
    const all = await as(owner, () => grants(db, 'newsroom'))
    expect(groupsOf('alice@example.com', memberships)).toEqual(
      expect.arrayContaining(['newsroom_reader', 'newsroom_writer', 'platform_users'])
    )
    expect(throughOf('alice@example.com', 'articles', all, memberships).sort()).toEqual([
      'newsroom_reader',
      'newsroom_writer',
    ])
  })

  test('everyone is asked about by PostgreSQL’s own name for them', async () => {
    const answers = await as(owner, () => reach(db, 'newsroom', { role: 'public' }))
    expect(answers).toHaveLength(3)
    expect(answers.every((row) => !row.usage && row.select === 'none')).toBe(true)
  })

  test('a role without USAGE on the workspace is said to lack it', async () => {
    const before = await as(owner, () => schemaReach(db, 'newsroom'))
    expect(before.find((row) => row.role === 'sales')).toMatchObject({
      usage: false,
      create: false,
    })
    expect(before.find((row) => row.role === 'bob@example.com')?.usage).toBe(true)
    await as(owner, () => pg.query(schemaGrantStatement('newsroom', ['USAGE'], 'sales')))
    const after = await as(owner, () => schemaReach(db, 'newsroom'))
    expect(after.find((row) => row.role === 'sales')?.usage).toBe(true)
    const acl = await as(owner, () => schemaGrants(db, 'newsroom'))
    expect(acl.some((g) => g.grantee === 'sales' && g.privilege === 'USAGE')).toBe(true)
    await as(owner, () => pg.query(schemaGrantStatement('newsroom', ['USAGE'], 'sales', true)))
  })

  test('a reader may ask about the roles they see and the ones the ACLs name', async () => {
    const answers = await as('alice@example.com', () =>
      reach(db, 'newsroom', { table: 'articles' })
    )
    const asked = answers.map((row) => row.role)
    expect(asked).toEqual(
      expect.arrayContaining(['alice@example.com', 'newsroom_reader', 'public'])
    )
    expect(asked).not.toContain('bob@example.com')
  })
})

describe('a change of what a role holds, run for real', () => {
  test('the whole collection, granted to a role that held nothing', async () => {
    const after = await change('corrections', 'sales', { SELECT: 'all', INSERT: 'all' })
    expect(after.statements).toHaveLength(1)
    expect(wantedOf(after.held.SELECT)).toBe('all')
    expect(wantedOf(after.held.INSERT)).toBe('all')
  })

  test('one field withheld from the whole collection leaves the others, by name', async () => {
    const every = [
      'id',
      'created_at',
      'updated_at',
      'created_by',
      'updated_by',
      'version',
      'article',
      'wording',
      'severity',
    ]
    const wanted = toggleField('all', 'SELECT', 'wording', false, every)
    const after = await change('corrections', 'sales', { SELECT: wanted })
    expect(after.held.SELECT?.whole).toBe(false)
    expect(after.held.SELECT?.columns.sort()).toEqual(every.filter((f) => f !== 'wording').sort())
    // What was not asked about is left as it was.
    expect(wantedOf(after.held.INSERT)).toBe('all')
  })

  test('fields widened to the whole collection leave no field grant behind', async () => {
    const after = await change('corrections', 'sales', { SELECT: 'all' })
    expect(after.held.SELECT).toEqual({ whole: true, columns: [] })
  })

  test('a field list changes by its difference', async () => {
    const before = await held('articles', 'newsroom_reader')
    const wanted = toggleField(wantedOf(before.SELECT), 'SELECT', 'internal_notes', true, fields)
    const after = await change('articles', 'newsroom_reader', { SELECT: wanted })
    expect(after.statements).toEqual([
      'GRANT SELECT ("internal_notes") ON TABLE "newsroom"."articles" TO "newsroom_reader";',
    ])
    expect(after.held.SELECT?.columns).toContain('internal_notes')
    const back = await change('articles', 'newsroom_reader', {
      SELECT: toggleField(wantedOf(after.held.SELECT), 'SELECT', 'internal_notes', false, fields),
    })
    expect(back.statements).toEqual([
      'REVOKE SELECT ("internal_notes") ON TABLE "newsroom"."articles" FROM "newsroom_reader";',
    ])
    expect(back.held.SELECT?.columns.sort()).toEqual([...(before.SELECT?.columns ?? [])].sort())
  })

  test('everything taken away takes the role out of the ACL', async () => {
    const after = await change('corrections', 'sales', { SELECT: 'none', INSERT: 'none' })
    expect(after.held).toEqual({})
    const all = await as(owner, () => grants(db, 'newsroom'))
    expect(granteesOf(all, 'corrections', owner)).toEqual(['newsroom_reader'])
  })

  test('PostgreSQL refuses the change to a role that does not own the collection', async () => {
    const statements = grantChangeStatements({
      schema: 'newsroom',
      table: 'articles',
      grantee: 'sales',
      held: {},
      wanted: { SELECT: 'all' },
    })
    await as('alice@example.com', async () => {
      await pg.query(statements[0]!)
    })
    // PostgreSQL warns and grants nothing when the grantor holds no grant option.
    expect(await held('articles', 'sales')).toEqual({})
  })
})

describe('a row policy that is changed', () => {
  test('is dropped and made again as PostgreSQL recorded it, with what was changed', async () => {
    const before = (await as(owner, () => policies(db))).find(
      (p) => p.name === 'published_articles'
    )!
    const draft = draftOf(before)
    expect(draft).toMatchObject({
      table: 'articles',
      command: 'SELECT',
      permissive: true,
      roles: ['newsroom_reader'],
    })
    const statements = [
      dropPolicyStatement('newsroom', before.table, before.name),
      policyStatement({ ...draft, roles: [...draft.roles, 'sales'] }, { requireExpression: true }),
    ]
    await as(owner, async () => {
      for (const statement of statements) await pg.query(statement)
    })
    const after = (await as(owner, () => policies(db))).find(
      (p) => p.name === 'published_articles'
    )!
    expect(after.roles.sort()).toEqual(['newsroom_reader', 'sales'])
    expect(after.using).toBe(before.using)
    expect(after.command).toBe('SELECT')
  })
})
