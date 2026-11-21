import { describe, expect, test } from 'bun:test'
import { grantStatement, InvalidName } from '../src/index.ts'

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
})
