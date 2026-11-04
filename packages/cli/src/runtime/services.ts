/**
 * The ports of a command.
 *
 * The ports are assembled per command: a dry run answers with a
 * transport that writes nothing, and the timeout of a call belongs to
 * the shell it runs in.
 */

import type { GlobalOptions, Services } from '../app/commands'
import { browserOf } from '../platform/browser'
import { loopbackCallback } from '../platform/callback'
import { machineCrypto } from '../platform/crypto'
import { FileCredentialStore, FileProfileStore } from '../platform/files'
import { DryRunHttp, FetchHttp } from '../platform/http'
import { TofuInfrastructure } from '../platform/tofu'
import { credentialsPath, environment, profilesPath, timeoutMs } from './env'

/**
 * The ports of a command.
 *
 * @param globals the options of the command.
 */
export function servicesOf(globals: GlobalOptions): Services {
  return {
    http: globals.dryRun
      ? new DryRunHttp()
      : new FetchHttp(timeoutMs(), globals.verbose, globals.requestId),
    profiles: new FileProfileStore(profilesPath),
    credentials: new FileCredentialStore(credentialsPath),
    browser: browserOf(),
    callback: loopbackCallback,
    crypto: machineCrypto,
    infrastructure: new TofuInfrastructure(environment, { progress }),
    files: { profiles: profilesPath, credentials: credentialsPath },
    progress,
  }
}

/**
 * The progress of a command goes on the standard error.
 *
 * The answer of a command goes on the standard output, and the
 * progress of a command goes beside it: a command that takes minutes
 * tells the operator what it is doing, and a script that reads the
 * answer reads the answer and nothing else.
 *
 * @param text the line of the progress.
 */
function progress(text: string): void {
  process.stderr.write(`${text}\n`)
}
