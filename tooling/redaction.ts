/**
 * The names whose values never reach a log.
 *
 * The four processes of the platform write logs, and each of them
 * redacts the names that carry a credential before it writes a line: a
 * token, a secret, a cookie or a password never reach a log, whatever
 * the layer that logs them.
 *
 * The lists were written one service at a time, and they drifted: the
 * gateway redacted a header that Access did not, and the console
 * redacted nothing at all while its own documentation promised that it
 * did. A list that is written twice is a list that is one list short of
 * the credential it has to hold back.
 *
 * The list is written here, once, and the check reads the list of every
 * logger of the platform and refuses the one that does not hold it back.
 * The loggers keep their own list — a service ships its own code and
 * reads nothing of another — but the check holds them to the same one.
 */

/**
 * The names of the headers and of the fields whose values never reach a
 * log.
 *
 * The list holds the headers that carry a credential, the fields that
 * hold one and the fields that carry a business value the platform
 * never writes. It is the union of what the four processes redact: a
 * name that is redacted by one of them is redacted by all of them.
 */
export const SENSITIVE_NAMES: readonly string[] = [
  'accessToken',
  'access_token',
  'authorization',
  'body',
  'client_secret',
  'code_verifier',
  'connectionString',
  'cookie',
  'credential',
  'databaseUrl',
  'email',
  'filter',
  'id_token',
  'password',
  'proxy-authorization',
  'query',
  'refresh_token',
  'secret',
  'session',
  'set-cookie',
  'token',
  'x-access-session',
  'x-access-token',
  'x-amz-security-token',
  'x-api-key',
  'x-gateway-session',
  'x-gateway-signature',
  'x-gateway-token',
]

/**
 * The names of the query parameters whose values never reach a log.
 *
 * An url is written in a log line, and an url carries the credentials
 * of a login in its query string. The names are the ones of the OAuth
 * flows and of the tokens.
 */
export const SENSITIVE_QUERY_NAMES: readonly string[] = [
  'access_token',
  'client_secret',
  'code',
  'code_verifier',
  'id_token',
  'password',
  'refresh_token',
  'secret',
  'state',
  'token',
]

/** The role of a process of the platform. */
export type Role = 'gateway' | 'access' | 'data' | 'console'

/**
 * A logger of the platform, and the file that holds its list.
 *
 * The names of the sets are the names the files give them: the check
 * reads the file and finds the list it holds.
 */
export interface RedactionSource {
  /** The path of the file, relative to the root of the repository. */
  readonly path: string
  /** The role of the process the logger belongs to. */
  readonly role: Role
  /** The name of the set that holds the names of the headers and of the fields. */
  readonly set: string
  /** The name of the set that holds the names of the query parameters, when there is one. */
  readonly querySet?: string
}

/**
 * The loggers of the platform, and the lists they hold.
 *
 * Every process of the platform writes a log, and every one of them
 * redacts what it must. The check reads these files.
 */
export const REDACTION_SOURCES: readonly RedactionSource[] = [
  {
    path: 'packages/gateway/src/observability/logging.ts',
    role: 'gateway',
    set: 'SENSITIVE_NAMES',
    querySet: 'SENSITIVE_QUERY_KEYS',
  },
  {
    path: 'packages/access/src/observability/logging.ts',
    role: 'access',
    set: 'SENSITIVE_KEYS',
    querySet: 'SENSITIVE_QUERY_KEYS',
  },
  {
    path: 'packages/data/src/observability/logger.ts',
    role: 'data',
    set: 'REDACTED_FIELDS',
  },
  {
    path: 'packages/console/src/runtime/log.ts',
    role: 'console',
    set: 'SENSITIVE_FIELDS',
  },
]

/**
 * Reads the names of a set out of the source that holds it.
 *
 * The source is read, not run: the check reads the files of the
 * repository and never imports the code it checks. A set that is not in
 * the source is an empty one, and the check reports it.
 *
 * @param content the source of the logger.
 * @param name the name of the set.
 */
export function namesOfSet(content: string, name: string): string[] {
  const declaration = new RegExp(`\\b${name}\\s*=\\s*new Set\\(\\[`)
  const match = declaration.exec(content)
  if (!match) return []
  const start = match.index + match[0].length
  const end = content.indexOf('])', start)
  if (end < 0) return []
  const body = content.slice(start, end)
  return [...body.matchAll(/'([^']*)'/g)]
    .map((entry) => entry[1] ?? '')
    .filter((entry) => entry !== '')
}

/**
 * The names of the canonical list that a logger does not redact.
 *
 * @param content the source of the logger.
 * @param set the name of the set of the logger.
 * @param canonical the names that every logger redacts.
 */
export function missingOf(content: string, set: string, canonical: readonly string[]): string[] {
  const names = new Set(namesOfSet(content, set).map((name) => name.toLowerCase()))
  return canonical.filter((name) => !names.has(name.toLowerCase()))
}

/**
 * A name of the canonical list that a logger does not redact.
 */
export interface RedactionFinding {
  /** The file the logger is in. */
  readonly file: string
  /** The role of the process the logger belongs to. */
  readonly role: Role
  /** The name that is not redacted. */
  readonly name: string
  /** The set of the logger that does not hold it back. */
  readonly set: string
}

/**
 * Reports the names of the canonical list that a logger does not redact.
 *
 * @param path the path of the file, relative to the root of the repository.
 * @param source the logger and the sets it holds.
 * @param content the source of the logger.
 */
export function redactionOf(
  path: string,
  source: RedactionSource,
  content: string
): RedactionFinding[] {
  const findings: RedactionFinding[] = []
  for (const name of missingOf(content, source.set, SENSITIVE_NAMES)) {
    findings.push({ file: path, role: source.role, name, set: source.set })
  }
  if (source.querySet) {
    for (const name of missingOf(content, source.querySet, SENSITIVE_QUERY_NAMES)) {
      findings.push({ file: path, role: source.role, name, set: source.querySet })
    }
  }
  return findings
}
