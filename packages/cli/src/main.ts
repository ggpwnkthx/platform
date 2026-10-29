/**
 * The entry point of the CLI.
 *
 * The process ends with the status of the command: a script that runs
 * the CLI branches on it, and a person reads what it printed. A failure
 * is a message on the standard error, and never a stack trace.
 */

import { run, type CliRuntime } from './app/cli'
import { resolveContext } from './domains/context'
import { CliFailure, type ExitCode } from './domains/failure'
import { FileProfileStore } from './platform/files'
import { commands, groups } from './runtime/commands'
import { environment, profilesPath } from './runtime/env'
import { servicesOf } from './runtime/services'
import { NAME } from './runtime/version'

/**
 * The main of the CLI.
 */
async function main(): Promise<ExitCode> {
  const runtime: CliRuntime = {
    name: NAME,
    commands,
    groups,
    environment,
    services: servicesOf,
    async contextOf(profile?: string) {
      const profiles = await new FileProfileStore(profilesPath).read()
      return resolveContext(profiles, environment, profile)
    },
    out: (text) => {
      process.stdout.write(`${text}\n`)
    },
    err: (text) => {
      process.stderr.write(`${text}\n`)
    },
  }
  try {
    return await run(runtime, process.argv.slice(2))
  } catch (error) {
    if (error instanceof CliFailure) {
      runtime.err(`error: ${error.message}`)
      return error.exit
    }
    runtime.err(`error: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

const status = await main()
process.exit(status)
