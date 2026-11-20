import { describe, expect, test } from 'bun:test'
import {
  columnPrivileges,
  createRoleStatement,
  createRoleStatements,
  dropPolicyStatement,
  grantChangeStatements,
  grantStatement,
  InvalidName,
  membershipStatement,
  onDeleteAction,
  policyStatement,
  rowSecurityStatement,
  schemaPrivilegeNames,
  schemaPrivileges,
  schemaStatement,
  tablePrivilegeNames,
  tablePrivileges,
} from '../src/index.ts'

/**
 * The access the platform grants, written once: the operator's tools converge a database on
 * a manifest, the interface shows the reader the statement before it runs. The statement is
 * the same either way, so that a grant made in one is the grant the other makes.
 */
describe('the access the platform grants', () => {
  test('a grant names the collection, the privileges and the role', () => {
    expect(
      grantStatement({
        schema: 'newsroom',
        table: 'articles',
        privileges: ['select', 'insert'],
        columns: [],
        grantee: 'writer',
        withGrantOption: false,
      })
    ).toBe('GRANT SELECT, INSERT ON TABLE "newsroom"."articles" TO "writer";')
  })

  test('a grant without a collection is a grant on the workspace itself', () => {
    expect(
      grantStatement({
        schema: 'newsroom',
        table: null,
        privileges: ['usage'],
        columns: [],
        grantee: 'writer',
        withGrantOption: false,
      })
    ).toBe('GRANT USAGE ON SCHEMA "newsroom" TO "writer";')
  })

  test('public is everyone, and never a role of that name', () => {
    expect(
      grantStatement({
        schema: 'newsroom',
        table: 'articles',
        privileges: ['select'],
        columns: [],
        grantee: 'Public',
        withGrantOption: false,
      })
    ).toContain('TO PUBLIC;')
    expect(
      grantStatement({
        schema: 'newsroom',
        table: 'articles',
        privileges: ['select'],
        columns: [],
        grantee: 'public_reader',
        withGrantOption: false,
      })
    ).toContain('TO "public_reader";')
  })

  test('a field list narrows only the privileges PostgreSQL may narrow', () => {
    const sql = grantStatement({
      schema: 'newsroom',
      table: 'articles',
      privileges: ['insert', 'update', 'delete'],
      columns: ['title'],
      grantee: 'writer',
      withGrantOption: false,
    })
    expect(sql).toBe(
      'GRANT INSERT ("title"), UPDATE ("title"), DELETE ON TABLE "newsroom"."articles" TO "writer";'
    )
  })

  test('every privilege cannot be limited to fields: it would grant more than was asked', () => {
    expect(() =>
      grantStatement({
        schema: 'newsroom',
        table: 'articles',
        privileges: ['all'],
        columns: ['title'],
        grantee: 'writer',
        withGrantOption: false,
      })
    ).toThrow(InvalidName)
  })

  test('every privilege at once is every privilege', () => {
    expect(
      grantStatement({
        schema: 'newsroom',
        table: 'articles',
        privileges: ['all'],
        columns: [],
        grantee: 'writer',
        withGrantOption: false,
      })
    ).toBe('GRANT ALL PRIVILEGES ON TABLE "newsroom"."articles" TO "writer";')
  })

  test('a grant may be taken back', () => {
    expect(
      grantStatement(
        {
          schema: 'newsroom',
          table: 'articles',
          privileges: ['select'],
          columns: [],
          grantee: 'writer',
          withGrantOption: false,
        },
        true
      )
    ).toBe('REVOKE SELECT ON TABLE "newsroom"."articles" FROM "writer";')
  })

  test('a grant may be passed on', () => {
    expect(
      grantStatement({
        schema: 'newsroom',
        table: 'articles',
        privileges: ['select'],
        columns: [],
        grantee: 'writer',
        withGrantOption: true,
      })
    ).toContain('WITH GRANT OPTION;')
  })

  test('a grant without a privilege, or without a role, is refused', () => {
    const draft = {
      schema: 'newsroom',
      table: 'articles',
      privileges: [],
      columns: [],
      grantee: 'writer',
      withGrantOption: false,
    }
    expect(() => grantStatement(draft)).toThrow(InvalidName)
    expect(() => grantStatement({ ...draft, privileges: ['select'], grantee: '' })).toThrow(
      InvalidName
    )
  })

  test('the two spellings of the privileges are one vocabulary', () => {
    expect(tablePrivilegeNames.map((p) => p.toUpperCase())).toEqual([...tablePrivileges, 'ALL'])
    expect(schemaPrivilegeNames.map((p) => p.toUpperCase())).toEqual([...schemaPrivileges, 'ALL'])
    expect(columnPrivileges.map((p) => p.toLowerCase())).toEqual([
      'select',
      'insert',
      'update',
      'references',
    ])
  })

  test('a policy carries the clauses its command allows', () => {
    const sql = policyStatement({
      schema: 'newsroom',
      table: 'articles',
      name: 'own',
      permissive: true,
      command: 'ALL',
      roles: ['writer'],
      using: 'created_by=session_user',
      check: 'created_by=session_user',
    })
    expect(sql).toBe(
      'CREATE POLICY "own" ON "newsroom"."articles"\n' +
        '  AS PERMISSIVE FOR ALL TO "writer"\n' +
        '  USING (created_by=session_user)\n' +
        '  WITH CHECK (created_by=session_user);'
    )
  })

  test('a policy for INSERT has no old row to read, and one for SELECT writes nothing', () => {
    const policy = {
      schema: 'newsroom',
      table: 'articles',
      name: 'own',
      permissive: true,
      roles: ['writer'],
      using: '',
      check: '',
    }
    expect(() =>
      policyStatement({ ...policy, command: 'INSERT', using: 'created_by=session_user' })
    ).toThrow(InvalidName)
    expect(() =>
      policyStatement({ ...policy, command: 'SELECT', check: 'created_by=session_user' })
    ).toThrow(InvalidName)
  })

  test('a policy expression stays inside its parentheses', () => {
    const policy = {
      schema: 'newsroom',
      table: 'articles',
      name: 'own',
      permissive: true,
      command: 'SELECT' as const,
      roles: ['writer'],
      check: '',
    }
    const using = (expression: string) => policyStatement({ ...policy, using: expression })
    // What PostgreSQL would read as one expression is written as it is.
    for (const expression of [
      "status IN ('draft', 'it''s; done)') AND (created_by = session_user)",
      'EXISTS (SELECT 1 FROM newsroom.desks d WHERE d.id = desk_id AND d."lead;)" = session_user)',
      "note = E'a \\' quote ;)' OR note = $q$ ;) $q$ OR note = $$ -- $$",
    ])
      expect(using(expression)).toContain(`USING (${expression})`)
    // What would end the clause early, and be read as a statement of its own, is refused.
    for (const expression of [
      'true); DROP TABLE newsroom.articles; --',
      'true) WITH CHECK (true',
      'true; COMMIT',
      '(created_by = session_user',
      "status = 'draft",
      'true -- and the rest',
      'true /* and the rest',
      'note = $q$ never closed',
    ])
      expect(() => using(expression)).toThrow(InvalidName)
  })

  test('a policy with no role of its own is for everyone', () => {
    expect(
      policyStatement({
        schema: 'newsroom',
        table: 'articles',
        name: 'own',
        permissive: true,
        command: 'SELECT',
        roles: [],
        using: 'true',
        check: '',
      })
    ).toContain('TO PUBLIC')
  })

  test('a policy, a membership and a role are written the same way either side', () => {
    expect(dropPolicyStatement('newsroom', 'articles', 'own')).toBe(
      'DROP POLICY "own" ON "newsroom"."articles";'
    )
    expect(rowSecurityStatement('newsroom', 'articles', true)).toBe(
      'ALTER TABLE "newsroom"."articles" ENABLE ROW LEVEL SECURITY;'
    )
    expect(membershipStatement({ role: 'writers', member: 'alice', admin: true })).toBe(
      'GRANT "writers" TO "alice" WITH ADMIN OPTION;'
    )
    expect(membershipStatement({ role: 'writers', member: 'alice', admin: false }, true)).toBe(
      'REVOKE "writers" FROM "alice";'
    )
    expect(createRoleStatement({ name: 'alice@example.com', login: true })).toBe(
      'CREATE ROLE "alice@example.com" LOGIN;'
    )
    expect(createRoleStatements({ name: 'alice', login: true })).toEqual([
      'CREATE ROLE "alice" LOGIN;',
      'GRANT platform_users TO "alice";',
    ])
    expect(createRoleStatements({ name: 'writers', login: false })).toEqual([
      'CREATE ROLE "writers" NOLOGIN;',
    ])
  })

  test('a workspace is a schema, and its owner', () => {
    expect(schemaStatement('newsroom', null)).toBe('CREATE SCHEMA "newsroom";')
    expect(schemaStatement('newsroom', 'alice@example.com')).toBe(
      'CREATE SCHEMA "newsroom" AUTHORIZATION "alice@example.com";'
    )
  })

  test('a relation’s foreign key says what happens to the row it points at', () => {
    expect(onDeleteAction('restrict')).toBe('RESTRICT')
    expect(onDeleteAction('cascade')).toBe('CASCADE')
    expect(onDeleteAction('set_null')).toBe('SET NULL')
  })
})

/**
 * A change of what a role holds on a collection is the difference between two states, and
 * PostgreSQL's two levels — the collection and its fields — do not mirror each other.
 */
describe('a change of what a role holds', () => {
  const change = (
    held: Parameters<typeof grantChangeStatements>[0]['held'],
    wanted: Parameters<typeof grantChangeStatements>[0]['wanted'],
    withGrantOption = false
  ) =>
    grantChangeStatements({
      schema: 'newsroom',
      table: 'articles',
      grantee: 'reader',
      held,
      wanted,
      withGrantOption,
    })

  test('what is already as wanted writes nothing', () => {
    expect(
      change(
        { SELECT: { whole: true, columns: [] }, UPDATE: { whole: false, columns: ['title'] } },
        { SELECT: 'all', UPDATE: ['title'], DELETE: 'none' }
      )
    ).toEqual([])
  })

  test('privileges granted alike are granted in one statement', () => {
    expect(change({}, { SELECT: 'all', INSERT: 'all', DELETE: 'all' })).toEqual([
      'GRANT SELECT, INSERT, DELETE ON TABLE "newsroom"."articles" TO "reader";',
    ])
    expect(change({}, { INSERT: ['title', 'status'], UPDATE: ['title', 'status'] })).toEqual([
      'GRANT INSERT ("title", "status"), UPDATE ("title", "status") ON TABLE "newsroom"."articles" TO "reader";',
    ])
  })

  test('a privilege taken away is revoked on the collection, which takes its fields with it', () => {
    expect(
      change({ SELECT: { whole: false, columns: ['id', 'title'] } }, { SELECT: 'none' })
    ).toEqual(['REVOKE SELECT ON TABLE "newsroom"."articles" FROM "reader";'])
  })

  test('narrowing the whole collection to fields revokes it and grants the fields', () => {
    expect(change({ SELECT: { whole: true, columns: [] } }, { SELECT: ['id', 'title'] })).toEqual([
      'REVOKE SELECT ON TABLE "newsroom"."articles" FROM "reader";',
      'GRANT SELECT ("id", "title") ON TABLE "newsroom"."articles" TO "reader";',
    ])
  })

  test('widening fields to the whole collection gives the field grants up', () => {
    expect(change({ SELECT: { whole: false, columns: ['id'] } }, { SELECT: 'all' })).toEqual([
      'REVOKE SELECT ("id") ON TABLE "newsroom"."articles" FROM "reader";',
      'GRANT SELECT ON TABLE "newsroom"."articles" TO "reader";',
    ])
  })

  test('a field list changes by its difference alone', () => {
    expect(
      change(
        { UPDATE: { whole: false, columns: ['title', 'status'] } },
        { UPDATE: ['title', 'body'] }
      )
    ).toEqual([
      'REVOKE UPDATE ("status") ON TABLE "newsroom"."articles" FROM "reader";',
      'GRANT UPDATE ("body") ON TABLE "newsroom"."articles" TO "reader";',
    ])
  })

  test('what is newly granted may be passed on', () => {
    expect(change({}, { SELECT: 'all' }, true)).toEqual([
      'GRANT SELECT ON TABLE "newsroom"."articles" TO "reader" WITH GRANT OPTION;',
    ])
  })

  test('a privilege that covers the whole collection is not limited to fields', () => {
    expect(() => change({}, { DELETE: ['title'] })).toThrow(InvalidName)
    expect(() => change({}, { SELECT: [] })).toThrow(InvalidName)
  })
})
