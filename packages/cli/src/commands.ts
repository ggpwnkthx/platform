import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type pg from 'pg'
import { applyManifest } from './apply.ts'
import { findConfig, readApplied } from './config.ts'
import { administratorManifest, applyFolder, type Applied, deploymentVariables } from './folder.ts'
import { transaction } from './database/db.ts'
import { authenticationProblems, postureNotes, requirePostgres18 } from './database/requirements.ts'
import { setLogin } from './login.ts'
import { applyModel } from './model.ts'
import { MIGRATIONS } from './migrations.ts'
import { options } from './options.ts'
import { VERSION, requireInstalledVersion } from './version.ts'

/**
 * The commands that speak to the database. Every other command of the platform's own is
 * answered without one. The relay is not among them: it is a program of its own, run beside
 * the server, and it holds no connection to PostgreSQL at all.
 */
export const DATABASE_COMMANDS = [
  'migrate',
  'apply',
  'model:apply',
  'sql',
  'doctor',
  'lock',
  'unlock',
  'harden',
]

/**
 * What a folder applies, read: the files its `platform.json` says it applies. The folder is
 * any folder that holds one, named as `ui build --dir` names it.
 */
function appliedIn(dir: string): Applied {
  if (!dir) throw new Error('--dir needs a folder: the one that holds platform.json')
  const config = findConfig(resolve(dir))
  if (!config) throw new Error(`There is no platform.json in ${resolve(dir)}`)
  return readApplied(config)
}

/** Applies what a deployment is given: its manifests, and what a folder says it applies. */
async function apply(q: pg.Client, args: string[]) {
  const { values, rest } = options(
    args,
    {
      'dry-run': { type: 'boolean' },
      administrator: { type: 'boolean' },
      dir: { type: 'string' },
    },
    { positionals: 'keep' }
  )
  const dry = values['dry-run']
  // The deployment's administrator, and nothing else: there is somebody to sign in as.
  const administrator = values.administrator
  // What a folder applies: its models, then its migration and its demonstration.
  // It is applied first, so that a manifest beside it may name the folder's administrator
  // as the owner of a workspace.
  const applied = values.dir === undefined ? undefined : appliedIn(values.dir)
  const files = rest
  if (!files.length && !applied && !administrator)
    throw new Error(
      'apply needs a deployment and at least one manifest file, --dir or --administrator'
    )
  // The manifests are applied through the platform's own functions, which the installation
  // provides from 2.0.1 on. An older database is upgraded first, not worked around.
  await requireInstalledVersion(q)
  const manifests = [
    ...(administrator ? [administratorManifest()] : []),
    ...files.map((file) => JSON.parse(readFileSync(file, 'utf8'))),
  ]
  const changes: string[] = []
  const notes: string[] = []
  let unchanged = 0
  // One transaction for everything: a deployment is never left between two manifests, or
  // between a folder's schema and its records.
  await q.query('BEGIN')
  try {
    if (applied) {
      const result = await applyFolder(q, applied, deploymentVariables())
      changes.push(...result.changes)
      notes.push(...result.notes)
      unchanged += result.unchanged
    }
    for (const raw of manifests) {
      const result = await applyManifest(q, raw)
      changes.push(...result.changes)
      unchanged += result.unchanged
    }
    await q.query(dry ? 'ROLLBACK' : 'COMMIT')
  } catch (error) {
    await q.query('ROLLBACK').catch(() => undefined)
    throw error
  }
  for (const change of changes) console.log(`${dry ? '~' : '+'} ${change}`)
  for (const note of notes) console.log(`- ${note}`)
  console.log(
    `${changes.length} ${dry ? 'to change' : 'changed'}, ${unchanged} already in place.${dry ? ' Dry run: nothing was changed.' : ''}`
  )
}

/** Installs the platform in the database, or upgrades what is already there. */
async function migrate(q: pg.Client) {
  await transaction(q, async () => {
    await q.query("SELECT pg_advisory_xact_lock(hashtext('platform.install'))")
    const existing = await q.query(
      "SELECT to_regnamespace('sys') AS reserved,to_regclass('platform.installation') AS installed"
    )
    if (existing.rows[0].reserved)
      throw new Error('Existing sys schema found. Install in a dedicated empty database.')
    let pending = MIGRATIONS
    let installed = false
    if (existing.rows[0].installed) {
      installed = true
      const r = await q.query('SELECT version FROM platform.installation')
      const at = MIGRATIONS.findIndex((m) => m.version === r.rows[0]?.version)
      if (at < 0) throw new Error(`Unsupported installation version ${r.rows[0]?.version}`)
      pending = MIGRATIONS.slice(at + 1)
    }
    if (!pending.length) {
      console.log(`Already installed at version ${VERSION}`)
      return
    }
    for (const migration of pending) await q.query(migration.sql)
    console.log(
      installed
        ? `Upgraded PostgreSQL-native platform to version ${VERSION}`
        : `Installed PostgreSQL-native platform version ${VERSION}`
    )
  })
}

/** Says what the deployment has left open: the server, its logins, and the installation. */
async function doctor(q: pg.Client) {
  console.log(
    (
      await q.query(
        `SELECT session_user,current_user,current_database(),current_setting('server_version') AS postgresql,
          version AS platform FROM platform.installation`
      )
    ).rows[0]
  )
  const problems = await authenticationProblems(q)
  if (problems === 'unchecked')
    console.log('Authentication rules not checked: that needs a superuser or pg_read_all_settings.')
  else if (problems.length) {
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  } else console.log('Authentication rules: network logins are by token.')
  for (const said of await postureNotes(q)) console.log(`Note: ${said}`)
}

/** Runs a file of the caller's own: a model, or SQL. */
async function runFile(q: pg.Client, command: string, args: string[]) {
  const file = args[0]
  if (!file) throw new Error(`${command} needs a file path`)
  const text = readFileSync(file, 'utf8')
  const result =
    command === 'model:apply' ? await applyModel(q, JSON.parse(text)) : await q.query(text)
  console.log(result)
}

/**
 * The command that was asked for, run against the database it was connected to. The
 * arguments are the ones the command was given, the first of which names the deployment or
 * the file for the commands that take one.
 */
export async function databaseCommand(
  q: pg.Client,
  command: string,
  args: string[]
): Promise<void> {
  if (command === 'migrate' || command === 'doctor') await requirePostgres18(q)
  if (command === 'apply') await apply(q, args.slice(1))
  else if (command === 'migrate') await migrate(q)
  else if (command === 'doctor') await doctor(q)
  else if (command === 'lock' || command === 'unlock')
    for (const said of await setLogin(q, command, args[0])) console.log(said)
  else await runFile(q, command, args)
}
