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
import { credentialsPath, profilesPath, timeoutMs } from './env'

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
    files: { profiles: profilesPath, credentials: credentialsPath },
  }
}
