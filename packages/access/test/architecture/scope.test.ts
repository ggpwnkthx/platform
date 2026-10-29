import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * The scope of the statements of the storage (spec §3.10).
 *
 * The row level security of the database is the backstop of the
 * isolation of the tenants, and it is a backstop that holds only when
 * every statement carries a scope: a statement that was not given a
 * scope sees nothing, and it sees nothing silently.
 *
 * The test reads the storage and holds that no statement runs without a
 * scope. It is the guard of the next statement that forgets one: the
 * tests of the storage run as the owner of the schema, and the owner is
 * not subject to the policies of the tables, so a statement that
 * forgets its scope is invisible to them.
 */
const root = resolve(import.meta.dir, '..', '..')
const storage = join(root, 'src', 'platform', 'postgres')

/**
 * The files of the storage whose statements do not carry a scope.
 *
 * They are the infrastructure: the migrations run as the owner of the
 * schema, the driver of the embedded database speaks to the server
 * itself, and the audit of the administration is a table of the
 * infrastructure that carries no row of a tenant.
 */
const WITHOUT_SCOPE: readonly string[] = [
  'audit.ts',
  'database.ts',
  'migrations.ts',
  'pglite.ts',
  'postgres.ts',
  'scope.ts',
  'trace.ts',
]

/** The files of the storage. */
async function filesOfStorage(): Promise<string[]> {
  const entries = await readdir(storage, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => entry.name)
    .filter((name) => !name.endsWith('.test.ts'))
}

describe('the scope of the statements of the storage', () => {
  test('every statement of the storage carries a scope', async () => {
    const unscoped: string[] = []
    for (const name of await filesOfStorage()) {
      if (WITHOUT_SCOPE.includes(name)) continue
      const content = await readFile(join(storage, name), 'utf8')
      // A statement that runs on the pool of the connections, and not on
      // the client of a transaction that carries a scope, is a statement
      // without a scope.
      if (/\bdb\.query[<(]/.test(content) || /\bthis\.db\.query[<(]/.test(content)) {
        unscoped.push(name)
      }
    }
    expect(unscoped.sort()).toEqual([])
  })

  test('the scope of a statement is never the default', async () => {
    const content = await readFile(join(storage, 'scope.ts'), 'utf8')
    // The scope of a statement is set inside its transaction: the
    // setting is local to the transaction, and a pooled connection never
    // carries the scope of another request.
    expect(content).toContain('set_config($1, $2, true)')
    // The scope of the platform is asked for by name.
    expect(content).toContain("const PLATFORM_SCOPE = 'platform'")
    // There is no scope that means "everything" by default.
    expect(content).not.toContain('current_setting')
  })

  test('the policies of the tables refuse a statement without a scope', async () => {
    const content = await readFile(join(storage, 'migrations', '0013_explicit_scope.sql'), 'utf8')
    // Every policy of the domain reads the scope of the statement, and
    // the tenant of the scope: a statement without a scope matches
    // neither branch and sees no row.
    const policies = content.match(/create policy [a-z_]+ on [a-z_]+/g) ?? []
    expect(policies.length).toBe(8)
    expect(content.match(/current_setting\('access\.scope', true\) = 'platform'/g)?.length).toBe(8)
    expect(
      content.match(/nullif\(current_setting\('access\.tenant_id', true\), ''\)/g)?.length
    ).toBe(8)
  })
})
