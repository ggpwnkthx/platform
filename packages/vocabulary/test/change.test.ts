import { describe, expect, test } from 'bun:test'
import { grantChangeStatements, InvalidName } from '../src/index.ts'

/**
 * The access the platform grants, written once: the operator's tools converge a database on
 * a manifest, the interface shows the reader the statement before it runs. The statement is
 * the same either way, so that a grant made in one is the grant the other makes.
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
