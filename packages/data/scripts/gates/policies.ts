#!/usr/bin/env bun
/**
 * The shape of the policies of the tables (spec §11).
 *
 * The row level security of the tables is the backstop of the isolation
 * of the tenants and of the workspaces. The backstop holds only when the
 * policies of a table are the policies of the role that uses it:
 *
 * - a policy that names no role applies to every role, and the policies
 *   of PostgreSQL are combined with a logical or. A policy that holds
 *   every row of a table therefore undoes the policy that holds the rows
 *   of the scope, and the isolation of that table is gone. A policy of
 *   the deployment names its role, or it reads the scope of the
 *   transaction.
 * - the role a policy names is one of the roles of the separation. A
 *   policy that names a role nobody has is a policy nobody holds.
 * - a table that holds rows has its row level security enabled **and**
 *   forced, so the owner of the table is subject to the policies of the
 *   table as well.
 *
 * The check reads the migrations of the deployment and it holds the
 * **effective** policy of every table: the last migration that creates
 * a policy is the policy of the deployment, and a migration that drops a
 * policy removes it. The check fails the build instead of being noticed
 * in a review: the policies of the outbox named no role, and the role of
 * the api read the events of every tenant until the migration that gave
 * them their role.
 *
 * It runs in the test suite (`test/architecture/policies.test.ts`) and in
 * the CI workflow.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

/** The directory that holds the migrations of the deployment. */
export const MIGRATIONS = 'migrations'

/** The roles of the separation (spec §6.4). */
export const ROLES: readonly string[] = [
  'data_owner',
  'data_runtime',
  'data_registry',
  'data_delivery',
  'data_maintenance',
]

/** The setting that carries the scope of the transaction. */
const SCOPE = 'current_setting'

/**
 * The tables of the infrastructure: they hold no row of a tenant, and
 * their reader is a role of the deployment and not a tenant.
 */
export const INFRASTRUCTURE: readonly string[] = ['platform.schema_migrations']

/** One problem of the shape of the policies. */
export interface PolicyProblem {
  /** The file the problem is in. */
  readonly file: string
  /** What is wrong. */
  readonly message: string
}

/** The statements of a migration, split on the semicolons. */
function statementsOf(source: string): string[] {
  return source
    .split(';')
    .map((statement) =>
      statement
        .replace(/--[^\n]*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter((statement) => statement !== '')
}

/** Reads the migrations of the deployment, in the order they apply. */
async function migrationsOf(directory: string): Promise<{ file: string; source: string }[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort()
  const read: { file: string; source: string }[] = []
  for (const file of files) {
    read.push({ file, source: await readFile(join(directory, file), 'utf8') })
  }
  return read
}

/**
 * Checks the shape of the policies of the migrations.
 *
 * @param directory the directory that holds the migrations.
 */
export async function checkPolicies(directory = MIGRATIONS): Promise<PolicyProblem[]> {
  const problems: PolicyProblem[] = []
  const migrations = await migrationsOf(directory)

  // The tables whose isolation is enabled, and the tables whose
  // isolation is forced. A table that is enabled and not forced is
  // subject to the policies of the others and not to its own.
  const enabled = new Set<string>()
  const forced = new Set<string>()
  // The tables that hold rows.
  const tables = new Set<string>()
  // The effective policy of every table: the last migration that
  // creates a policy is the policy of the deployment.
  const effective = new Map<string, { file: string; table: string; statement: string }>()

  for (const migration of migrations) {
    for (const statement of statementsOf(migration.source)) {
      const createTable = /^create table if not exists (\S+)/i.exec(statement)
      if (createTable) {
        tables.add(createTable[1]!.toLowerCase())
        continue
      }
      const enable = /^alter table (\S+) enable row level security/i.exec(statement)
      if (enable) {
        enabled.add(enable[1]!.toLowerCase())
        continue
      }
      const force = /^alter table (\S+) force row level security/i.exec(statement)
      if (force) {
        forced.add(force[1]!.toLowerCase())
        continue
      }
      const drop = /^drop policy (\S+) on (\S+)/i.exec(statement)
      if (drop) {
        effective.delete(drop[1]!.toLowerCase())
        continue
      }
      const create = /^create policy (\S+) on (\S+)/i.exec(statement)
      if (create) {
        effective.set(create[1]!.toLowerCase(), {
          file: migration.file,
          table: create[2]!.toLowerCase(),
          statement,
        })
      }
    }
  }

  // The effective policy of every table.
  for (const policy of effective.values()) {
    const name = policy.statement.match(/^create policy (\S+)/i)?.[1] ?? ''

    // A policy names the role it belongs to, or it reads the scope of
    // the transaction. A policy that does neither applies to every
    // role and holds every row.
    const to = /\bto\s+(\S+)/i.exec(policy.statement)
    const readsScope = policy.statement.includes(SCOPE)
    if (!to && !readsScope) {
      problems.push({
        file: policy.file,
        message:
          `the policy "${name}" of the table "${policy.table}" names no role and reads no scope: ` +
          'it applies to every role and holds every row of the table',
      })
      continue
    }
    if (to) {
      const role = to[1]!.toLowerCase()
      if (!ROLES.includes(role)) {
        problems.push({
          file: policy.file,
          message:
            `the policy "${name}" of the table "${policy.table}" names the role "${to[1]}", ` +
            'which is not one of the roles of the separation',
        })
      }
    }
    // A policy of a table that holds rows is a policy of a table whose
    // isolation is enabled and forced.
    if (!enabled.has(policy.table)) {
      problems.push({
        file: policy.file,
        message: `the table "${policy.table}" holds a policy and does not enable its row level security`,
      })
    } else if (!forced.has(policy.table)) {
      problems.push({
        file: policy.file,
        message:
          `the table "${policy.table}" does not force its row level security: ` +
          'the owner of the table is not subject to it',
      })
    }
  }

  // Every table that holds rows of the backend has its isolation
  // enabled and forced.
  for (const migration of migrations) {
    for (const statement of statementsOf(migration.source)) {
      const createTable = /^create table if not exists (\S+)/i.exec(statement)
      if (!createTable) continue
      const name = createTable[1]!.toLowerCase()
      if (INFRASTRUCTURE.includes(name)) continue
      if (!enabled.has(name)) {
        problems.push({
          file: migration.file,
          message: `the table "${createTable[1]}" does not enable its row level security`,
        })
        continue
      }
      if (!forced.has(name)) {
        problems.push({
          file: migration.file,
          message: `the table "${createTable[1]}" does not force its row level security`,
        })
      }
    }
  }

  return problems
}

if (import.meta.main) {
  const problems = await checkPolicies()
  if (problems.length === 0) {
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'the policies of the deployment are the policies of their role',
      })
    )
  } else {
    for (const problem of problems) {
      console.error(`${relative(process.cwd(), problem.file)}: ${problem.message}`)
    }
    process.exit(1)
  }
}
