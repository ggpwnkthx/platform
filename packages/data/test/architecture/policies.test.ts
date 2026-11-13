/**
 * The shape of the policies of the tables.
 *
 * The row level security of the tables is the backstop of the isolation
 * of the tenants. The backstop holds only when the policies of a table
 * are the policies of the role that uses it: a policy that names no role
 * applies to every role, and the policies of PostgreSQL are combined
 * with a logical or.
 *
 * The test holds two things: the migrations of the deployment pass the
 * check, and the check refuses the shapes that undo the isolation.
 */

import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkPolicies, INFRASTRUCTURE, MIGRATIONS, ROLES } from '../../scripts/gates/policies'

/** Writes a migration in a directory of its own and checks it. */
async function checkOf(source: string): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), 'data-policies-'))
  try {
    await writeFile(join(directory, '0001_isolation.sql'), source)
    return (await checkPolicies(directory)).map((problem) => problem.message)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** A migration that holds one table and one policy of the scope. */
const SCOPED = `
create table if not exists platform.records (
  id uuid primary key,
  tenant_id uuid not null
);

alter table platform.records enable row level security;
alter table platform.records force row level security;

create policy records_scope on platform.records
  using (
    tenant_id = nullif(current_setting('data.tenant_id', true), '')::uuid
  )
  with check (
    tenant_id = nullif(current_setting('data.tenant_id', true), '')::uuid
  );
`

describe('the shape of the policies', () => {
  test('the migrations of the deployment pass the check', async () => {
    expect(await checkPolicies(MIGRATIONS)).toEqual([])
  })

  test('a policy that reads the scope is a policy of the deployment', async () => {
    expect(await checkOf(SCOPED)).toEqual([])
  })

  test('a policy that names no role and reads no scope is refused', async () => {
    const problems = await checkOf(
      `${SCOPED}
create policy records_registry_read on platform.records
  using (true)
  with check (false);
`
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('names no role and reads no scope')
  })

  test('a policy that names a role that nobody holds is refused', async () => {
    const problems = await checkOf(
      `${SCOPED}
create policy records_owner on platform.records
  for all
  to data_nobody
  using (true)
  with check (true);
`
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('data_nobody')
  })

  test('a table that does not force its isolation is refused', async () => {
    const problems = await checkOf(`
create table if not exists platform.records (
  id uuid primary key,
  tenant_id uuid not null
);

alter table platform.records enable row level security;

create policy records_scope on platform.records
  using (
    tenant_id = nullif(current_setting('data.tenant_id', true), '')::uuid
  );
`)
    expect(problems.length).toBeGreaterThan(0)
    expect(
      problems.some((problem) => problem.includes('does not force its row level security'))
    ).toBe(true)
  })

  test('a table that does not enable its isolation is refused', async () => {
    const problems = await checkOf(`
create table if not exists platform.records (
  id uuid primary key,
  tenant_id uuid not null
);
`)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('does not enable its row level security')
  })

  test('the ledger of the migrations is the table of the infrastructure', () => {
    expect(INFRASTRUCTURE).toContain('platform.schema_migrations')
  })

  test('the roles of the separation are the five of the deployment', () => {
    expect(ROLES).toEqual([
      'data_owner',
      'data_runtime',
      'data_registry',
      'data_delivery',
      'data_maintenance',
    ])
  })
})
