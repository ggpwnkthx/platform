import { chmodSync, writeFileSync } from 'node:fs'
import { ZodError, z } from 'zod'
import { loadConfig } from './database/config.ts'
import { transaction } from './database/db.ts'
import { deploy } from './deployment/index.ts'
import { hardenNotes, hardenSql, type HardenMode } from './harden.ts'
import { Cancelled, close, note, type Waiting, waiting } from './terminal.ts'
import { options, unexpected } from './options.ts'
import { deviceToken } from './token.ts'
import { VERSION } from './version.ts'
import { connection } from './connection.ts'
import { DATABASE_COMMANDS, databaseCommand } from './commands.ts'
import { HELP } from './help.ts'

/**
 * Hides the role catalogs from ordinary connections, so that psql no longer reads who
 * belongs to which group. It needs the cluster superuser, and it is the server's own
 * business rather than the deployment's.
 */
async function harden(args: string[]) {
  const { values, rest } = options(
    args,
    { 'keep-names': { type: 'boolean' }, restore: { type: 'boolean' } },
    { positionals: 'keep' }
  )
  const [target, ...extra] = rest
  if (extra.length) unexpected(extra)
  if (!target || !['local', 'k8s', 'kubernetes'].includes(target))
    throw new Error('harden needs a deployment: local or k8s')
  const mode: HardenMode = values['keep-names']
    ? 'keep-names'
    : values.restore
      ? 'restore'
      : 'strict'
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

/**
 * Signs in through the issuer in a browser and prints the token, or writes it to a file of
 * the caller's own for PGTOKEN_FILE to read.
 */
async function token(args: string[]) {
  const config = loadConfig()
  if (!config.oidcIssuer) throw new Error('OIDC_ISSUER is required')
  // The token is the only thing on stdout, so that it can be captured. With --out it is
  // not on stdout at all: it is written to a file of the caller's own, for PGTOKEN_FILE,
  // and never passes through a terminal's scrollback, a pipe or a CI log.
  const { values } = options(args, { out: { type: 'string' } })
  const out = values.out
  let signingIn: Waiting | undefined
  const printed = await deviceToken(
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
    writeFileSync(out, `${printed}\n`, { mode: 0o600 })
    // The mode above is for a file that was not there: one that was keeps its own.
    chmodSync(out, 0o600)
    note(`The token is in ${out}, readable by you alone: pass it as PGTOKEN_FILE=${out}`)
  } else console.log(printed)
}

/**
 * The command the operator asked for. Everything that does not need the database is
 * answered without one, and everything that does is answered against one connection.
 */
export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const command = args[0]
  if (command === 'deploy') {
    process.exitCode = await deploy(args.slice(1))
    return
  }
  if (command === 'harden') {
    await harden(args.slice(1))
    return
  }
  if (command === 'ui') {
    // A built site is served by the server alone: nothing of the interface is loaded for it.
    if (args[1] === 'serve') {
      const { serve } = await import('./ui/serve.ts')
      process.exitCode = serve(args.slice(2))
      return
    }
    // Loaded here, so that the operator's commands do not carry the interface with them.
    const { ui } = await import('./ui/index.ts')
    process.exitCode = await ui(args.slice(1))
    return
  }
  if (command === '--version' || command === 'version') {
    console.log(VERSION)
    return
  }
  if (command === 'token') {
    await token(args.slice(1))
    return
  }
  if (!DATABASE_COMMANDS.includes(command ?? '')) {
    console.log(HELP)
    return
  }
  const q = connection(command === 'apply' ? (args[1] ?? '') : undefined)
  await q.connect()
  try {
    await databaseCommand(q, command ?? '', args.slice(1))
  } finally {
    await q.end()
  }
}

// The program runs only when it is the program: a test may ask it what it would do.
if (import.meta.main)
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
