import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { ZodError, z } from 'zod'
import { applyManifest } from './apply.ts'
import { loadConfig } from './config.ts'
import { bearer, clientConfig, TokenClient, transaction } from './db.ts'
import { deploy, localDatabase } from './deploy.ts'
import { hardenNotes, hardenSql, type HardenMode } from './harden.ts'
import { authenticationProblems, requirePostgres18 } from './requirements.ts'
import { deviceToken } from './token.ts'
import { VERSION } from './version.ts'
import { applyModel } from './model.ts'

/** The installation scripts, in order, each one leaving the database at the version it names. */
const MIGRATIONS = [
  { file: '0001_native.sql', version: '2.0.0' },
  { file: '0002_harden_catalogs.sql', version: '2.0.1' },
  { file: '0003_metadata.sql', version: '2.1.0' },
]
if (MIGRATIONS[MIGRATIONS.length - 1]!.version !== VERSION)
  throw new Error(`The last migration must produce version ${VERSION}`)

const secret = (name: string) => {
  const path = process.env[`${name}_FILE`]
  const value = path ? readFileSync(path, 'utf8').trimEnd() : process.env[name]
  if (!value) throw new Error(`${name} or ${name}_FILE is required`)
  return value
}
const given = (name: string) => !!(process.env[name] || process.env[`${name}_FILE`])
/**
 * The database of a deployment, connected as the operator this command acts as: a person, with
 * the token in PGTOKEN[_FILE]; or the installer's administrator, the one login with a password.
 */
function connection(target?: string): pg.Client {
  let config = loadConfig()
  let administrator: { username: string; password?: string } | undefined
  if (target === 'local') {
    const db = localDatabase()
    config = loadConfig({
      OIDC_CLAIM: process.env.OIDC_CLAIM,
      DATABASE_HOST: db.host,
      DATABASE_PORT: db.port,
      DATABASE_NAME: db.name,
      DATABASE_SSL: 'disable',
    })
    // The stack's own administrator unless the operator names another login.
    administrator = db
  } else if (target !== undefined && target !== 'k8s' && target !== 'kubernetes')
    throw new Error(`Unknown deployment: ${target}. Supported deployments: local, k8s.`)
  if (given('PGTOKEN')) {
    const who = bearer(`Bearer ${secret('PGTOKEN')}`, config.oidcClaim)
    return new TokenClient(clientConfig(config, who), who.token)
  }
  if (given('PGUSER') || !administrator)
    return new pg.Client(
      clientConfig(config, { username: secret('PGUSER'), password: secret('PGPASSWORD') })
    )
  if (!administrator.password)
    throw new Error(
      'The local deployment has no saved administrator password. Run deploy local up, or set PGTOKEN[_FILE], or PGUSER and PGPASSWORD[_FILE].'
    )
  return new pg.Client(clientConfig(config, administrator))
}
async function apply(q: pg.Client, args: string[]) {
  const dry = args.includes('--dry-run')
  const files = args.filter((a) => a !== '--dry-run')
  const unknown = files.find((a) => a.startsWith('--'))
  if (unknown) throw new Error(`Unknown option: ${unknown}`)
  if (!files.length) throw new Error('apply needs a deployment and at least one manifest file')
  // The manifests are applied through the platform's own functions, which the installation
  // provides from 2.0.1 on. An older database is upgraded first, not worked around.
  const installed = await q.query('SELECT version FROM platform.installation')
  if (installed.rows[0]?.version !== VERSION)
    throw new Error(
      `This installation is at version ${installed.rows[0]?.version ?? 'none'}. Run \`bun run cli migrate\` first.`
    )
  const manifests = files.map((file) => JSON.parse(readFileSync(file, 'utf8')))
  const changes: string[] = []
  let unchanged = 0
  // One transaction for every file: a deployment is never left between two manifests.
  await q.query('BEGIN')
  try {
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
  console.log(
    `${changes.length} ${dry ? 'to change' : 'changed'}, ${unchanged} already in place.${dry ? ' Dry run: nothing was changed.' : ''}`
  )
}
async function harden(args: string[]) {
  const [target, ...rest] = args
  if (!target || !['local', 'k8s', 'kubernetes'].includes(target))
    throw new Error('harden needs a deployment: local or k8s')
  const mode: HardenMode = rest.includes('--keep-names')
    ? 'keep-names'
    : rest.includes('--restore')
      ? 'restore'
      : 'strict'
  const unknown = rest.find((a) => !['--keep-names', '--restore'].includes(a))
  if (unknown) throw new Error(`Unknown option: ${unknown}`)
  const q = connection(target === 'kubernetes' ? 'k8s' : target)
  await q.connect()
  try {
    const superuser = (await q.query("SELECT current_setting('is_superuser') AS superuser")).rows[0]
      ?.superuser
    if (superuser !== 'on')
      throw new Error(
        'The role catalogs belong to the cluster superuser. Run harden as the cluster superuser.'
      )
    const installed = await q.query("SELECT to_regclass('platform.installation') AS installed")
    if (!installed.rows[0]?.installed)
      throw new Error('Platform is not installed here. Run `bun run cli migrate` first.')
    await transaction(q, async () => {
      await q.query(hardenSql(mode))
    })
    console.log(
      mode === 'restore'
        ? "Restored PostgreSQL's default access to the role catalogs."
        : 'Hid the role catalogs from ordinary connections.'
    )
    for (const note of hardenNotes(mode)) console.log(`- ${note}`)
  } finally {
    await q.end()
  }
}
async function main() {
  const command = process.argv[2]
  if (command === 'deploy') {
    process.exitCode = await deploy(process.argv.slice(3))
    return
  }
  if (command === 'harden') {
    await harden(process.argv.slice(3))
    return
  }
  if (command === '--version' || command === 'version') {
    console.log(VERSION)
    return
  }
  if (command === 'token') {
    const config = loadConfig()
    if (!config.oidcIssuer) throw new Error('OIDC_ISSUER is required')
    // The token is the only thing on stdout, so that it can be captured.
    console.log(
      await deviceToken(config.oidcIssuer, process.env.OIDC_CLI_CLIENT_ID ?? 'platform-psql', (m) =>
        console.error(m)
      )
    )
    return
  }
  if (
    !['migrate', 'apply', 'model:apply', 'sql', 'doctor', 'harden', 'relay'].includes(command ?? '')
  ) {
    console.log(`platform <command>
  migrate           Install or upgrade Platform ${VERSION} in a dedicated PostgreSQL 18 database.
                    Needs PGUSER/PGPASSWORD[_FILE] of its administrator.
  harden <local|k8s> [--keep-names|--restore]
                    Hide the role catalogs from ordinary connections, so that psql no longer
                    reads who belongs to which group. Needs the cluster superuser. --keep-names
                    leaves role names readable; --restore puts PostgreSQL's default back.
  apply <local|k8s> FILE... [--dry-run]
                    Apply JSON manifests of users, groups, workspaces, collections, grants and
                    policies to a deployment, in one transaction. local signs in as the local
                    stack's administrator unless PGTOKEN or PGUSER is set; k8s uses the settings below.
  model:apply FILE  Apply an additive JSON model using the caller's own DDL rights.
  sql FILE          Run a SQL file using the caller's own rights. Use BEGIN/COMMIT for atomic scripts.
  doctor            Check the server version, how it lets people in, and the installation.
  token             Sign in through OIDC_ISSUER in a browser and print a token for PGTOKEN,
                    psql or an Authorization: Bearer header.
  deploy            Deploy locally with Docker/Podman or to Kubernetes. Run deploy help.
  --version         Print the package version.
Database commands use DATABASE_HOST/PORT/NAME/SSL and act as the person whose token is in
PGTOKEN[_FILE], or as the installer's administrator in PGUSER/PGPASSWORD[_FILE]: the only
login that has a password. The HTTP server never loads any of them.`)
    return
  }
  const q = connection(command === 'apply' ? (process.argv[3] ?? '') : undefined)
  await q.connect()
  try {
    if (command === 'migrate' || command === 'doctor') await requirePostgres18(q)
    if (command === 'apply') await apply(q, process.argv.slice(4))
    else if (command === 'migrate')
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
        for (const migration of pending)
          await q.query(
            readFileSync(join(import.meta.dir, '../../../migrations', migration.file), 'utf8')
          )
        console.log(
          installed
            ? `Upgraded PostgreSQL-native platform to version ${VERSION}`
            : `Installed PostgreSQL-native platform version ${VERSION}`
        )
      })
    else if (command === 'doctor') {
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
        console.log(
          'Authentication rules not checked: that needs a superuser or pg_read_all_settings.'
        )
      else if (problems.length) {
        for (const problem of problems) console.error(problem)
        process.exitCode = 1
      } else console.log('Authentication rules: network logins are by token.')
    } else {
      const file = process.argv[3]
      if (!file) throw new Error(`${command} needs a file path`)
      const text = readFileSync(file, 'utf8')
      const result =
        command === 'model:apply' ? await applyModel(q, JSON.parse(text)) : await q.query(text)
      console.log(result)
    }
  } finally {
    await q.end()
  }
}
main().catch((error: Error & { code?: string }) => {
  console.error(
    error instanceof ZodError ? z.prettifyError(error) : error.message || error.code || error
  )
  process.exitCode = 1
})
