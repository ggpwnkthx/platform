import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { ZodError, z } from 'zod'
import { applyManifest } from './apply.ts'
import { findConfig, readApplied } from './config.ts'
import { administratorManifest, applyFolder, type Applied, deploymentVariables } from './folder.ts'
import { loadConfig } from './database/config.ts'
import { bearer, clientConfig, TokenClient, transaction } from './database/db.ts'
import { deploy, localDatabase } from './deployment/index.ts'
import { hardenNotes, hardenSql, type HardenMode } from './harden.ts'
import { setLogin } from './login.ts'
import { authenticationProblems, postureNotes, requirePostgres18 } from './database/requirements.ts'
import { Cancelled, close, note, type Waiting, waiting } from './terminal.ts'
import { deviceToken } from './token.ts'
import { VERSION, requireInstalledVersion } from './version.ts'
import { applyModel } from './model.ts'
import { MIGRATIONS } from './migrations.ts'

const secret = (name: string) => {
  const path = process.env[`${name}_FILE`]
  const value = path ? readFileSync(path, 'utf8').trimEnd() : process.env[name]
  if (!value) throw new Error(`${name} or ${name}_FILE is required`)
  return value
}
const given = (name: string) => !!(process.env[name] || process.env[`${name}_FILE`])
/**
 * The database of a deployment, connected as the operator this command acts as: a person, with
 * the token in PGTOKEN[_FILE]. No login has a password, the operator's included.
 *
 * The one connection without a token is the server's own socket: DATABASE_HOST names the
 * directory it is in, which only something running beside the server can reach. PostgreSQL
 * lets its own superuser in there, and that is how a server is installed before anybody has
 * a role to sign in as.
 */
function connection(target?: string): pg.Client {
  let config = loadConfig()
  if (target === 'local') {
    const db = localDatabase()
    config = loadConfig({
      OIDC_CLAIM: process.env.OIDC_CLAIM,
      DATABASE_HOST: db.host,
      DATABASE_PORT: db.port,
      DATABASE_NAME: db.name,
      DATABASE_SSL: 'disable',
    })
  } else if (target !== undefined && target !== 'k8s' && target !== 'kubernetes')
    throw new Error(`Unknown deployment: ${target}. Supported deployments: local, k8s.`)
  for (const name of ['PGPASSWORD', 'PGPASSWORD_FILE'])
    if (process.env[name])
      throw new Error(`${name} is not used: no login has a password. Sign in with a token.`)
  if (given('PGTOKEN')) {
    const who = bearer(`Bearer ${secret('PGTOKEN')}`, config.oidcClaim)
    return new TokenClient(clientConfig(config, who), who.token)
  }
  if (config.databaseHost.startsWith('/'))
    return new pg.Client({
      ...clientConfig(config, { username: process.env.PGUSER || 'postgres' }),
      ssl: false,
    })
  throw new Error(
    target === 'local'
      ? 'PGTOKEN or PGTOKEN_FILE is required: sign in with `bun run cli token` and pass what it prints. The local stack itself is administered with `bun run cli deploy local admin <command>`.'
      : 'PGTOKEN or PGTOKEN_FILE is required: sign in with `bun run cli token` and pass what it prints.'
  )
}
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
async function apply(q: pg.Client, args: string[]) {
  const dry = args.includes('--dry-run')
  // The deployment's administrator, and nothing else: there is somebody to sign in as.
  const administrator = args.includes('--administrator')
  // What a folder applies: its models, then its migration and its demonstration.
  // It is applied first, so that a manifest beside it may name the folder's administrator
  // as the owner of a workspace.
  const flag = args.find((a) => a === '--dir' || a.startsWith('--dir='))
  const applied = flag === undefined ? undefined : appliedIn(flag.slice('--dir='.length))
  const files = args.filter((a) => a !== '--dry-run' && a !== '--administrator' && a !== flag)
  const unknown = files.find((a) => a.startsWith('--'))
  if (unknown) throw new Error(`Unknown option: ${unknown}`)
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
  if (command === 'ui') {
    // A built site is served by the server alone: nothing of the interface is loaded for it.
    if (process.argv[3] === 'serve') {
      const { serve } = await import('./ui/serve.ts')
      process.exitCode = serve(process.argv.slice(4))
      return
    }
    // Loaded here, so that the operator's commands do not carry the interface with them.
    const { ui } = await import('./ui/index.ts')
    process.exitCode = await ui(process.argv.slice(3))
    return
  }
  if (command === '--version' || command === 'version') {
    console.log(VERSION)
    return
  }
  if (command === 'token') {
    const config = loadConfig()
    if (!config.oidcIssuer) throw new Error('OIDC_ISSUER is required')
    // The token is the only thing on stdout, so that it can be captured. With --out it is
    // not on stdout at all: it is written to a file of the caller's own, for PGTOKEN_FILE,
    // and never passes through a terminal's scrollback, a pipe or a CI log.
    const options = process.argv.slice(3)
    const unknown = options.find((a) => !a.startsWith('--out='))
    if (unknown) throw new Error(`Unknown option: ${unknown}`)
    const out = options.at(-1)?.slice('--out='.length)
    if (out === '') throw new Error('--out needs a file path')
    let signingIn: Waiting | undefined
    const token = await deviceToken(
      config.oidcIssuer,
      process.env.OIDC_CLI_CLIENT_ID ?? 'platform-psql',
      (message) => {
        note(message)
        signingIn = waiting('Waiting for the sign-in')
      }
    ).catch((error) => {
      signingIn?.fail('Not signed in')
      throw error
    })
    signingIn?.done('Signed in')
    if (out) {
      writeFileSync(out, `${token}\n`, { mode: 0o600 })
      // The mode above is for a file that was not there: one that was keeps its own.
      chmodSync(out, 0o600)
      note(`The token is in ${out}, readable by you alone: pass it as PGTOKEN_FILE=${out}`)
    } else console.log(token)
    return
  }
  if (
    ![
      'migrate',
      'apply',
      'model:apply',
      'sql',
      'doctor',
      'lock',
      'unlock',
      'harden',
      'relay',
    ].includes(command ?? '')
  ) {
    console.log(`platform <command>
  migrate           Install or upgrade Platform ${VERSION} in a dedicated PostgreSQL 18 database.
                    Needs the token of its administrator.
  harden <local|k8s> [--keep-names|--restore]
                    Hide the role catalogs from ordinary connections, so that psql no longer
                    reads who belongs to which group. Needs the cluster superuser. --keep-names
                    leaves role names readable; --restore puts PostgreSQL's default back.
  apply <local|k8s> FILE... [--dir=DIR] [--administrator] [--dry-run]
                    Apply JSON manifests of users, groups, workspaces, collections, grants and
                    policies to a deployment, in one transaction. --dir applies what a folder
                    says it applies in its platform.json, any folder that holds one: its
                    models.ts (the schema), then, beside the server, its migration.sql (what
                    a manifest cannot say) and, the first time, its demo.sql (records and
                    their history). --administrator makes the deployment's administrator
                    and nothing else. local is the local stack's published port; k8s uses the
                    settings below. Both need a token.
  model:apply FILE  Apply an additive JSON model using the caller's own DDL rights.
  sql FILE          Run a SQL file using the caller's own rights. Use BEGIN/COMMIT for atomic scripts.
  doctor            Check the server version, how it lets people in, and the installation, and
                    say what the deployment has left open: TLS, the role catalogs, collections
                    owned by a person, tables that write no revisions.
  lock ROLE         Take a role's login away (NOLOGIN) and end its open sessions: no token
                    logs it in until it is unlocked. For a person who has left, and for the
                    administrator between the times it is used.
  unlock ROLE       Give a role its login back. A superuser's is a superuser's to change: run
                    it beside the server, as \`deploy local admin unlock ROLE\` does.
  token [--out=FILE]
                    Sign in through OIDC_ISSUER in a browser and print a token for PGTOKEN,
                    psql or an Authorization: Bearer header. --out writes it to a file of
                    your own (mode 0600) for PGTOKEN_FILE, and prints nothing.
  deploy            Deploy locally with Docker/Podman or to Kubernetes. Run deploy help.
  ui                Build the interface as a static site, and serve it while it is worked on.
                    Run ui help.
  --version         Print the package version.
Database commands use DATABASE_HOST/PORT/NAME/SSL and act as the person whose token is in
PGTOKEN[_FILE]: \`platform token\` prints one. No login has a password. A DATABASE_HOST that is a
directory is the server's own socket, for a command that runs beside the server.`)
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
        for (const migration of pending) await q.query(migration.sql)
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
      for (const said of await postureNotes(q)) console.log(`Note: ${said}`)
    } else if (command === 'lock' || command === 'unlock') {
      for (const said of await setLogin(q, command, process.argv[3])) console.log(said)
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
  // A question left unanswered has already been said so, where it was asked.
  if (error instanceof Cancelled) {
    close()
    process.exitCode = 130
    return
  }
  // Under what the command had said so far, and the last thing it says.
  note(
    String(
      error instanceof ZodError ? z.prettifyError(error) : error.message || error.code || error
    ),
    'error'
  )
  close()
  process.exitCode = 1
})
