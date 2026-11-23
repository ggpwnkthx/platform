import { describe, expect, test } from 'bun:test'
import {
  describe as said,
  expiresAt,
  grantChangeStatements,
  grantStatement,
  ident,
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
