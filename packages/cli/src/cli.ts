#!/usr/bin/env bun
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import {
  administratorManifest,
  applyFolder,
  applyManifest,
  applyModel,
  type ApplyResult,
  type Db,
  deploymentVariables,
  requireInstalledVersion,
  script,
  transaction,
  VERSION,
} from '@platform/core'
import { type ArgsDef, type CommandDef, defineCommand, runMain } from 'citty'
import * as oidc from 'openid-client'
import { ZodError, z } from 'zod'
import platform from '../../../migrations/0001_platform.sql' with { type: 'text' }
import { doctor, hardenSql, open, setLogin } from './database.ts'
import { kubernetes, local, localDatabase } from './deploy.ts'
import { buildUi, devUi, readApplied, serveUi } from './site.ts'

/** The migrations, in order, and the version each leaves the database at. */
const MIGRATIONS = [{ version: '2.3.0', sql: platform }]

/** A deployment's database: the local stack's published port, or the one the environment names. */
const target = (deployment: string | undefined) => {
  if (deployment === 'local') return localDatabase()
  if (deployment === undefined || deployment === 'k8s' || deployment === 'kubernetes') return {}
  throw new Error(`Unknown deployment: ${deployment}. Supported deployments: local, k8s.`)
}
async function withDb<T>(deployment: string | undefined, work: (db: Db) => Promise<T>): Promise<T> {
  const db = await open(target(deployment))
  try {
    return await work(db)
  } finally {
    await db.end()
  }
}
const command = <T extends ArgsDef>(
  description: string,
  args: T,
  run: NonNullable<CommandDef<T>['run']>
) =>
  defineCommand({
    meta: { description },
    args,
    run: (context) =>
      Promise.resolve()
        .then(() => run(context))
        .catch((error) => {
          // A manifest that does not parse says where, in words.
          console.error(
            error instanceof ZodError ? z.prettifyError(error) : (error.message ?? error)
          )
          process.exit(1)
        }),
  })

const migrate = command(
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

const apply = command(
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

const file = { file: { type: 'positional', description: 'The file', required: true } } as const
const role = {
  role: {
    type: 'positional',
    description: 'The role: the address the person signs in with',
    required: true,
  },
} as const
const main = defineCommand({
  meta: {
    name: 'platform',
    version: VERSION,
    description:
      'Database commands use DATABASE_HOST/PORT/NAME/SSL and act as the person whose token is in PGTOKEN[_FILE]: `platform token` prints one. No login has a password.',
  },
  subCommands: {
    migrate,
    apply,
    'model:apply': command(
      'Apply an additive JSON model using the caller’s own DDL rights.',
      file,
      ({ args }) =>
        withDb(undefined, async (db) =>
          console.log(await applyModel(db, JSON.parse(readFileSync(args.file, 'utf8'))))
        )
    ),
    sql: command(
      'Run a SQL file using the caller’s own rights. Use BEGIN/COMMIT for atomic scripts.',
      file,
      ({ args }) =>
        withDb(undefined, async (db) => void (await script(db, readFileSync(args.file, 'utf8'))))
    ),
    doctor: command(
      'Check the server version, how it lets people in, and the installation, and say what the deployment has left open.',
      {},
      () =>
        withDb(undefined, async (db) => {
          if (!(await doctor(db, console.log))) process.exitCode = 1
        })
    ),
    lock: command(
      'Take a role’s login away (NOLOGIN) and end its open sessions.',
      role,
      ({ args }) =>
        withDb(undefined, async (db) =>
          console.log((await setLogin(db, 'lock', args.role)).join('\n'))
        )
    ),
    unlock: command('Give a role its login back.', role, ({ args }) =>
      withDb(undefined, async (db) =>
        console.log((await setLogin(db, 'unlock', args.role)).join('\n'))
      )
    ),
    harden: command(
      'harden <local|k8s>: hide the role catalogs from ordinary connections. Needs the cluster superuser.',
      {
        'keep-names': {
          type: 'boolean',
          description: 'Leave role names readable, so pg_dump and GRANT keep working for everyone',
        },
        restore: { type: 'boolean', description: 'Put PostgreSQL’s default back' },
      },
      ({ args }) => {
        if (!['local', 'k8s', 'kubernetes'].includes(args._[0] ?? ''))
          throw new Error('harden needs a deployment: local or k8s')
        const mode = args['keep-names'] ? 'keep-names' : args.restore ? 'restore' : 'strict'
        return withDb(args._[0], async (db) => {
          if (
            (await db.query<{ on: string }>("SELECT current_setting('is_superuser') AS on")).rows[0]
              ?.on !== 'on'
          )
            throw new Error(
              'The role catalogs belong to the cluster superuser. Run harden as the cluster superuser.'
            )
          await requireInstalledVersion(db)
          await transaction(db, () => script(db, hardenSql(mode)))
          console.log(
            mode === 'restore'
              ? "Restored PostgreSQL's default access to the role catalogs."
              : 'Hid the role catalogs from ordinary connections: psql \\du and pg_dump need a platform operator or superuser from now on. The interface shows each caller their own roles and memberships, as before.'
          )
        })
      }
    ),
    token: command(
      'Sign in through OIDC_ISSUER in a browser and print a token for PGTOKEN or psql.',
      {
        out: {
          type: 'string',
          description:
            'Write it to a file of your own (mode 0600) for PGTOKEN_FILE, and print nothing',
        },
      },
      async ({ args }) => {
        const issuer = process.env.OIDC_ISSUER
        if (!issuer) throw new Error('OIDC_ISSUER is required')
        // The local stack's Dex is plain HTTP; a real issuer is not.
        const insecure = issuer.startsWith('http:')
          ? { execute: [oidc.allowInsecureRequests] }
          : undefined
        const config = await oidc.discovery(
          new URL(issuer),
          process.env.OIDC_CLI_CLIENT_ID ?? 'platform-psql',
          undefined,
          oidc.None(),
          insecure
        )
        const device = await oidc.initiateDeviceAuthorization(config, { scope: 'openid email' })
        console.error(
          `Open ${device.verification_uri_complete ?? device.verification_uri} and enter the code ${device.user_code}`
        )
        const tokens = await oidc.pollDeviceAuthorizationGrant(config, device)
        if (!args.out) return console.log(tokens.access_token)
        writeFileSync(args.out, `${tokens.access_token}\n`, { mode: 0o600 })
        chmodSync(args.out, 0o600)
        console.error(
          `The token is in ${args.out}, readable by you alone: pass it as PGTOKEN_FILE=${args.out}`
        )
      }
    ),
    deploy: command(
      'deploy <local|k8s> <action>: local is up, init, admin CMD, ui, validate, build, status, logs, down (--engine, --timeout, --domain); k8s is render, validate, diff, apply, status, logs, down (--namespace, --domain, --image, --public-url, --oidc-issuer, --database-host, --database-port, --timeout). See docs/operations.md.',
      {},
      async ({ rawArgs }) => {
        const [where, action, ...rest] = rawArgs
        if (!where || !action)
          throw new Error(
            'deploy needs a target and an action: deploy local up, deploy k8s render. Run deploy --help.'
          )
        if (!['local', 'k8s', 'kubernetes'].includes(where))
          throw new Error(`Unknown deployment target: ${where}. Supported targets: local, k8s.`)
        process.exitCode = await (where === 'local'
          ? local(action, rest)
          : kubernetes(action, rest))
      }
    ),
    ui: defineCommand({
      meta: {
        description: 'Build the interface as a static site, and serve it while it is worked on.',
      },
      subCommands: {
        build: command(
          'Write the interface out as a static site: the pages, one bundle, the fonts, config.json and _headers.',
          {
            dir: {
              type: 'string',
              description:
                'The directory that holds platform.json; without one, the published interface is built into packages/ui/dist',
            },
            production: {
              type: 'boolean',
              description:
                'Build the published interface: the one that signs in through the issuer and reaches PostgreSQL through the relay',
            },
          },
          async ({ args }) => console.log(`The site is in ${await buildUi(args)}`)
        ),
        dev: command(
          'Serve the site, rebuilding it on every change. A folder that applies something runs PostgreSQL inside the page.',
          {
            dir: { type: 'string', description: 'The directory that holds platform.json' },
            relay: {
              type: 'string',
              description:
                'HOST:PORT of a real PostgreSQL: serve the published interface and forward its sessions there',
            },
            port: { type: 'string', description: 'Default: 5173' },
          },
          ({ args }) => devUi({ ...args, port: args.port ? Number(args.port) : undefined })
        ),
        serve: command(
          'Serve a site that is already built, as the files it is.',
          {
            dir: { type: 'string', description: 'The built site', required: true },
            port: { type: 'string', description: 'Default: 8080' },
          },
          ({ args }) =>
            void console.log(
              `Serving ${args.dir} on port ${serveUi(args.dir, Number(args.port ?? 8080)).port}`
            )
        ),
      },
    }),
    version: command('Print the package version.', {}, () => console.log(VERSION)),
  },
})

if (import.meta.main) runMain(main)
