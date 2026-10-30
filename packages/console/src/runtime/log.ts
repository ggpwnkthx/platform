/**
 * The log of the console.
 *
 * One json object per line on the standard output, the way the three
 * services of the platform write theirs. A credential, a token or a
 * cookie is never a field of a line.
 */

import type { LogLevel } from './config'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** The replacement of a redacted value. */
const REDACTED = '[redacted]'

/**
 * The names whose values must never be logged verbatim.
 *
 * The set holds the headers that carry a credential and the fields that
 * hold one: a token, a secret, a cookie or a password never reach a log
 * line, whatever the layer that logs them.
 *
 * The list is the one of the platform (`tooling/redaction.ts`): the
 * loggers of the four processes hold the same names back, and the check
 * of the redaction refuses the one that does not.
 */
const SENSITIVE_FIELDS = new Set([
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
])

/** The log of the console. */
export interface Logger {
  debug: (message: string, fields?: Record<string, unknown>) => void
  info: (message: string, fields?: Record<string, unknown>) => void
  warn: (message: string, fields?: Record<string, unknown>) => void
  error: (message: string, fields?: Record<string, unknown>) => void
}

/**
 * Removes the values that may not be logged.
 *
 * The redactor works on the names of the fields, not on their values: a
 * value that carries a secret under another name is the mistake of the
 * caller, and the callers of the console never pass one.
 */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]'
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1))
  if (value === null || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_FIELDS.has(key.toLowerCase()) ? REDACTED : redact(entry, depth + 1)
  }
  return out
}

/** Creates the log of the console, at a level. */
export function createLogger(
  level: LogLevel,
  write: (line: string) => void = defaultWrite
): Logger {
  const at =
    (lineLevel: LogLevel) =>
    (message: string, fields: Record<string, unknown> = {}): void => {
      if (ORDER[lineLevel] < ORDER[level]) return
      write(
        JSON.stringify({
          level: lineLevel,
          time: new Date().toISOString(),
          service: 'console',
          msg: message,
          ...(redact(fields) as Record<string, unknown>),
        })
      )
    }
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') }
}

function defaultWrite(line: string): void {
  process.stdout.write(`${line}\n`)
}
