import { describe, expect, test } from 'bun:test'
import {
  collectionTarget,
  createRoleStatements,
  fieldStatements,
  fieldTarget,
  membershipStatement,
  metadataStatements,
  parseManifest,
  parseRenderers,
  parseViews,
  policyStatement,
  renderersValue,
} from '../src/index.ts'

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
