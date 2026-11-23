import { readFileSync } from 'node:fs'
import {
  type ApplyResult,
  administratorManifest,
  applyFolder,
  applyManifest,
  applyModel,
  deploymentVariables,
  requireInstalledVersion,
  script,
  transaction,
  VERSION,
} from '@platform/core'
import platform from '../../../../migrations/0001_platform.sql' with { type: 'text' }
import { doctor, setLogin } from '../database/doctor.ts'
import { readApplied } from '../site.ts'
import { command, withDb } from './shared.ts'

/** The migrations, in order, and the version each leaves the database at. */
const MIGRATIONS = [{ version: '2.3.0', sql: platform }]

export const migrate = command(
  'Install or upgrade Platform in a dedicated PostgreSQL 18 database. Needs the token of its administrator.',
  {},
  () =>
    withDb(undefined, (db) =>
      transaction(db, async () => {
        const server = (
          await db.query<{ n: number }>("SELECT current_setting('server_version_num')::int AS n")
        ).rows[0]!.n
        if (server < 180000)
          throw new Error(
            `PostgreSQL 18 or newer is required; this server reports ${Math.floor(server / 10000)}`
          )
        await db.query("SELECT pg_advisory_xact_lock(hashtext('platform.install'))")
        const found = (
          await db.query<{ installed: unknown }>(
            "SELECT to_regclass('platform.installation') AS installed"
          )
        ).rows[0]
        const at = found?.installed
          ? (await db.query<{ version: string }>('SELECT version FROM platform.installation'))
              .rows[0]?.version
          : undefined
        const done = at === undefined ? -1 : MIGRATIONS.findIndex((m) => m.version === at)
        if (at !== undefined && done < 0) throw new Error(`Unsupported installation version ${at}`)
        const pending = MIGRATIONS.slice(done + 1)
        for (const migration of pending) await script(db, migration.sql)
        console.log(
          !pending.length
            ? `Already installed at version ${VERSION}`
            : `${at ? 'Upgraded' : 'Installed'} PostgreSQL-native platform ${at ? 'to ' : ''}version ${VERSION}`
        )
      })
    )
)

export const apply = command(
  'apply <local|k8s> FILE...: apply JSON manifests of users, groups, workspaces, collections, grants and policies, in one transaction.',
  {
    dir: {
      type: 'string',
      description:
        'Apply what a folder says it applies in its platform.json: models, then migration.sql and, the first time, demo.sql',
    },
    administrator: {
      type: 'boolean',
      description: "Make the deployment's administrator and nothing else",
    },
    'dry-run': { type: 'boolean', description: 'Say what would change, and change nothing' },
  },
  ({ args }) => {
    const [deployment, ...files] = args._
    if (!deployment) throw new Error('apply needs a deployment: local or k8s')
    if (!files.length && !args.dir && !args.administrator)
      throw new Error('apply needs at least one manifest file, --dir or --administrator')
    const dry = !!args['dry-run']
    const variables = deploymentVariables(process.env)
    return withDb(deployment, async (db) => {
      await requireInstalledVersion(db)
      const applied = args.dir ? await readApplied(args.dir) : null
      const results: ApplyResult[] = []
      await transaction(
        db,
        async () => {
          if (applied) results.push(await applyFolder(db, applied, variables))
          if (args.administrator)
            results.push(await applyManifest(db, administratorManifest(variables.admin)))
          for (const file of files)
            results.push(await applyManifest(db, JSON.parse(readFileSync(file, 'utf8'))))
        },
        dry
      )
      const changes = results.flatMap((r) => r.changes)
      for (const change of changes) console.log(`${dry ? '~' : '+'} ${change}`)
      for (const note of results.flatMap((r) => r.notes)) console.log(`- ${note}`)
      console.log(
        `${changes.length} ${dry ? 'to change' : 'changed'}, ${results.reduce((n, r) => n + r.unchanged, 0)} already in place.${dry ? ' Dry run: nothing was changed.' : ''}`
      )
    })
  }
)

export const file = {
  file: { type: 'positional', description: 'The file', required: true },
} as const
export const role = {
  role: {
    type: 'positional',
    description: 'The role: the address the person signs in with',
    required: true,
  },
} as const

export const modelApply = command(
  'Apply an additive JSON model using the caller’s own DDL rights.',
  file,
  ({ args }) =>
    withDb(undefined, async (db) =>
      console.log(await applyModel(db, JSON.parse(readFileSync(args.file, 'utf8'))))
    )
)

export const sql = command(
  'Run a SQL file using the caller’s own rights. Use BEGIN/COMMIT for atomic scripts.',
  file,
  ({ args }) =>
    withDb(undefined, async (db) => void (await script(db, readFileSync(args.file, 'utf8'))))
)

export const doctorCommand = command(
  'Check the server version, how it lets people in, and the installation, and say what the deployment has left open.',
  {},
  () =>
    withDb(undefined, async (db) => {
      if (!(await doctor(db, console.log))) process.exitCode = 1
    })
)

export const lock = command(
  'Take a role’s login away (NOLOGIN) and end its open sessions.',
  role,
  ({ args }) =>
    withDb(undefined, async (db) => console.log((await setLogin(db, 'lock', args.role)).join('\n')))
)
export const unlock = command('Give a role its login back.', role, ({ args }) =>
  withDb(undefined, async (db) => console.log((await setLogin(db, 'unlock', args.role)).join('\n')))
)
