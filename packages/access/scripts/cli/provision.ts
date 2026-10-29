#!/usr/bin/env bun
/**
 * The provisioning of the role and of the database of Access
 * (spec §3.8).
 *
 * The script runs once per deployment, with the credentials of an
 * administrator of the server. It creates the role that owns the five
 * tables of the service and the database that holds them:
 *
 * - `access_owner` owns the tables of the service. It is the only role
 *   that may alter the schema, and the service uses it: the isolation
 *   of the tenants is the row level security of the tables, and it is
 *   forced, so the owner is subject to it as well.
 *
 * The environment of the script:
 *
 *   ACCESS_ADMIN_DATABASE_URL  the administrator of the server
 *   ACCESS_OWNER_PASSWORD      the password of the role
 *   ACCESS_DATABASE_NAME       the name of the database (default: access)
 *
 * The passwords come from the environment and they are never written to
 * a log. The script never prints them.
 */

import { Client } from 'pg'

/** The role that owns the tables of the service. */
const ROLE = 'access_owner'

/** The password of the role, from the environment. */
function passwordOf(): string {
  const value = process.env.ACCESS_OWNER_PASSWORD
  if (!value || value.length < 16) {
    throw new Error('ACCESS_OWNER_PASSWORD must be set and it is at least 16 characters')
  }
  return value
}

/** The identifier of the database of the service. */
const DATABASE = process.env.ACCESS_DATABASE_NAME ?? 'access'

/** Sets the password of the role, without putting it in a log. */
async function setPassword(admin: Client, name: string, password: string): Promise<void> {
  const statement = await admin.query<{ statement: string }>(
    `select format('alter role %I with login password %L', $1::text, $2::text) as statement`,
    [name, password]
  )
  await admin.query(statement.rows[0]!.statement)
}

async function main(): Promise<void> {
  const adminUrl = process.env.ACCESS_ADMIN_DATABASE_URL
  if (!adminUrl) {
    throw new Error(
      'ACCESS_ADMIN_DATABASE_URL must be set: it names the administrator of the server'
    )
  }

  // The role first: the database is owned by the owner of the tables.
  const admin = new Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    const exists = await admin.query('select 1 from pg_roles where rolname = $1', [ROLE])
    if (!exists.rowCount || exists.rowCount === 0) {
      await admin.query(`create role ${ROLE} with login`)
      console.log(JSON.stringify({ level: 'info', msg: 'a role was created', role: ROLE }))
    }
    await setPassword(admin, ROLE, passwordOf())

    const database = await admin.query('select 1 from pg_database where datname = $1', [DATABASE])
    if (!database.rowCount || database.rowCount === 0) {
      await admin.query(`create database ${DATABASE} owner ${ROLE}`)
      console.log(
        JSON.stringify({ level: 'info', msg: 'the database was created', database: DATABASE })
      )
    }
  } finally {
    await admin.end()
  }
}

await main()
