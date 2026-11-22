import { describe, expect, test } from 'bun:test'
import {
  collectionTarget,
  createRoleStatements,
  describe as said,
  expiresAt,
  fieldStatements,
  fieldTarget,
  grantChangeStatements,
  grantStatement,
  ident,
  membershipStatement,
  metadataStatements,
  parseManifest,
  parseRenderers,
  parseViews,
  policyStatement,
  renderersValue,
  roleOf,
  versionMismatch,
} from '../src/index.ts'

const token = (claims: object) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`

describe('names and values', () => {
  test('identifiers are quoted, and held to what PostgreSQL holds', () => {
    expect(ident('alice@example.com')).toBe('"alice@example.com"')
    expect(ident('a"b', 'c')).toBe('"a""b"."c"')
    expect(() => ident('')).toThrow()
    expect(() => ident('x'.repeat(64))).toThrow()
  })
  test('a token names a role, and says when it ends', () => {
    expect(roleOf(token({ email: 'alice@example.com' }), 'email')).toBe('alice@example.com')
    expect(roleOf(token({ email: 'x'.repeat(64) }), 'email')).toBeNull()
    expect(roleOf('not a token', 'email')).toBeNull()
    expect(expiresAt(token({ exp: 10 }))).toBe(10000)
  })
  test('an installation of another version is told apart', () => {
    expect(versionMismatch('2.3.0', '2.3.0')).toBeNull()
    expect(versionMismatch('2.2.9', '2.3.0')).toBe('older')
    expect(versionMismatch('3.0.0', '2.3.0')).toBe('newer')
  })
  test('a refusal carries its SQLSTATE', () => {
    const error = Object.assign(new Error('permission denied for table articles'), {
      code: '42501',
      hint: 'Ask its owner.',
    })
    expect(said(error)).toEqual({
      title: 'permission denied for table articles (42501)',
      detail: 'Hint: Ask its owner.',
    })
    expect(said(new Error('plain'))).toEqual({ title: 'plain' })
  })
})

describe('grants', () => {
  const on = { schema: 'newsroom', table: 'articles', grantee: 'newsroom_writer' }
  test('a grant names its privileges, its fields and its roles', () => {
    expect(
      grantStatement({
        ...on,
        privileges: ['select', 'update', 'delete'],
        columns: ['title', 'status'],
      })
    ).toBe(
      'GRANT SELECT ("title", "status"), UPDATE ("title", "status"), DELETE ON TABLE "newsroom"."articles" TO "newsroom_writer";'
    )
    expect(
      grantStatement(
        { schema: 'newsroom', table: null, privileges: ['usage'], grantee: ['a', 'public'] },
        true
      )
    ).toBe('REVOKE USAGE ON SCHEMA "newsroom" FROM "a", PUBLIC;')
    expect(() => grantStatement({ ...on, privileges: ['select; drop table x'] })).toThrow(
      'not a privilege'
    )
    expect(() => grantStatement({ ...on, privileges: ['all'], columns: ['title'] })).toThrow()
  })
  test('narrowing from the collection to fields revokes the collection and names the fields', () => {
    expect(
      grantChangeStatements({
        ...on,
        held: { SELECT: { whole: true, columns: [] } },
        wanted: { SELECT: ['id', 'title'] },
      })
    ).toEqual([
      'REVOKE SELECT ON TABLE "newsroom"."articles" FROM "newsroom_writer";',
      'GRANT SELECT ("id", "title") ON TABLE "newsroom"."articles" TO "newsroom_writer";',
    ])
  })
  test('widening gives the field grants up; changing fields writes only the difference', () => {
    expect(
      grantChangeStatements({
        ...on,
        held: { UPDATE: { whole: false, columns: ['title'] } },
        wanted: { UPDATE: 'all' },
      })
    ).toEqual([
      'REVOKE UPDATE ("title") ON TABLE "newsroom"."articles" FROM "newsroom_writer";',
      'GRANT UPDATE ON TABLE "newsroom"."articles" TO "newsroom_writer";',
    ])
    expect(
      grantChangeStatements({
        ...on,
        held: { INSERT: { whole: false, columns: ['title', 'status'] } },
        wanted: { INSERT: ['title', 'section'] },
      })
    ).toEqual([
      'REVOKE INSERT ("status") ON TABLE "newsroom"."articles" FROM "newsroom_writer";',
      'GRANT INSERT ("section") ON TABLE "newsroom"."articles" TO "newsroom_writer";',
    ])
    expect(
      grantChangeStatements({
        ...on,
        held: { DELETE: { whole: true, columns: [] } },
        wanted: { DELETE: 'all' },
      })
    ).toEqual([])
    expect(() => grantChangeStatements({ ...on, held: {}, wanted: { DELETE: ['title'] } })).toThrow(
      'whole collection'
    )
  })
})

describe('policies, roles and the model', () => {
  test('a policy is written as PostgreSQL reads it', () => {
    const draft = {
      schema: 'newsroom',
      table: 'articles',
      name: 'own',
      permissive: true,
      command: 'ALL' as const,
      roles: ['newsroom_writer'],
      using: 'created_by = session_user',
      check: '',
    }
    expect(policyStatement(draft)).toBe(
      'CREATE POLICY "own" ON "newsroom"."articles" AS PERMISSIVE FOR ALL TO "newsroom_writer"\n  USING (created_by = session_user);'
    )
    expect(() => policyStatement({ ...draft, command: 'INSERT' })).toThrow('no USING')
    expect(() => policyStatement({ ...draft, command: 'SELECT', check: 'true' })).toThrow(
      'no WITH CHECK'
    )
  })
  test('a person may sign in once they belong to the platform’s users', () => {
    expect(createRoleStatements({ name: 'carol@example.com', login: true })).toEqual([
      'CREATE ROLE "carol@example.com" LOGIN;',
      'GRANT "platform_users" TO "carol@example.com";',
    ])
    expect(createRoleStatements({ name: 'editors', login: false })).toEqual([
      'CREATE ROLE "editors" NOLOGIN;',
    ])
    expect(membershipStatement({ role: 'editors', member: 'carol@example.com', admin: true })).toBe(
      'GRANT "editors" TO "carol@example.com" WITH ADMIN OPTION;'
    )
  })
  test('a field is a column with real constraints, and carries its own saying', () => {
    const statements = fieldStatements('newsroom', 'places', {
      name: 'spot',
      type: 'public.geometry',
      modifiers: ['Point', '4326'],
      required: true,
      indexed: true,
      note: "Where it's at",
    })
    expect(statements.slice(0, 3)).toEqual([
      'ALTER TABLE "newsroom"."places" ADD COLUMN "spot" "public"."geometry"("Point", 4326) NOT NULL;',
      'CREATE INDEX ON "newsroom"."places" ("spot");',
      `COMMENT ON COLUMN "newsroom"."places"."spot" IS 'Where it''s at';`,
    ])
    expect(statements[3]).toContain(`'{"list":"show","record":"show","filter":"show"}'::jsonb`)
    expect(() => fieldStatements('n', 't', { name: 'id', type: 'text' })).toThrow(
      'made with every collection'
    )
    expect(() =>
      fieldStatements('n', 't', { name: 'n', type: 'integer', default: '1; drop' })
    ).toThrow('not a number')
  })
  test('metadata is written by the item’s names, and a null takes a key away', () => {
    const [set, unset] = metadataStatements(collectionTarget('newsroom', 'articles'), [
      { key: 'icon', value: 'file-text' },
      { key: 'color', value: null },
    ])
    expect(set).toContain(
      `VALUES ('collection', 'newsroom', 'articles', NULL, 'icon', '"file-text"'::jsonb)`
    )
    expect(unset).toStartWith('DELETE FROM platform.item_metadata')
    expect(metadataStatements(fieldTarget('n', 't', 'c'), [])).toEqual([])
  })
})

describe('what fields and manifests say', () => {
  test('views are read leniently and held to what a situation knows', () => {
    expect(
      parseViews({ list: false, record: 'readonly', filter: 'readonly', export: 'hide', junk: 3 })
    ).toEqual({ list: 'hide', record: 'readonly', filter: 'show', export: 'hide' })
    expect(parseViews(null)).toEqual({ list: 'show', record: 'show', filter: 'show' })
  })
  test('renderers are a name, or a name and its options', () => {
    const parsed = parseRenderers({
      list: 'truncate',
      record: { renderer: 'template', options: { template: '» {value}' } },
      filter: { renderer: 'no good!' },
    })
    expect(parsed).toEqual({
      list: { renderer: 'truncate', options: {} },
      record: { renderer: 'template', options: { template: '» {value}' } },
    })
    expect(renderersValue(parsed)).toEqual({
      list: 'truncate',
      record: { renderer: 'template', options: { template: '» {value}' } },
    })
  })
  test('a manifest is strict about what it may say', () => {
    expect(
      parseManifest({ workspace: { slug: 'crm' }, collections: [{ name: 'accounts' }] })
        .workspaces[0]
    ).toMatchObject({ slug: 'crm', collections: [{ name: 'accounts', fields: [] }] })
    expect(() => parseManifest({ collections: [] })).toThrow('belong to a workspace')
    expect(() => parseManifest({ users: [{ name: 'a', password: 'x' }] })).toThrow()
    expect(() =>
      parseManifest({
        workspaces: [
          {
            slug: 'w',
            collections: [
              { name: 'c', fields: [{ name: 'f', type: 'text', metadata: { views: {} } }] },
            ],
          },
        ],
      })
    ).toThrow('views')
  })
})
