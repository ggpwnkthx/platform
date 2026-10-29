/**
 * The environment of the CLI.
 *
 * The CLI reads the environment of the shell, and it reads nothing else:
 * it has no service of its own, and no variable of a service configures
 * it. The variables it reads carry its own name, and they name a
 * deployment.
 */

import { configDirectory, dataDirectory } from '../platform/files'

/** The environment of the process, as the shell hands it over. */
export const environment: Readonly<Record<string, string | undefined>> = process.env

/** The path of the file of the profiles of the deployments. */
export const profilesPath = `${configDirectory(environment)}/config.json`

/** The path of the file of the credential of the caller. */
export const credentialsPath = `${dataDirectory(environment)}/credentials.json`

/**
 * The timeout of a call, in milliseconds.
 *
 * The timeout of a call is the timeout of the shell: a command that
 * hangs holds the operator, and the operator has other work.
 */
export function timeoutMs(): number {
  const raw = environment.PLATFORMCTL_TIMEOUT_MS
  if (!raw) return 30_000
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000
}
