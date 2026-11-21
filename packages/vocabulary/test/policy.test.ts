import { describe, expect, test } from 'bun:test'
import {
  columnPrivileges,
  createRoleStatement,
  createRoleStatements,
  dropPolicyStatement,
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
