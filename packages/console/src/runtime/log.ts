/**
 * The log of the console.
 *
 * One json object per line on the standard output, the way the three
 * services of the platform write theirs. A credential, a token or a
 * cookie is never a field of a line.
 */

import type { LogLevel } from './config'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/** The log of the console. */
export interface Logger {
  debug: (message: string, fields?: Record<string, unknown>) => void
  info: (message: string, fields?: Record<string, unknown>) => void
  warn: (message: string, fields?: Record<string, unknown>) => void
  error: (message: string, fields?: Record<string, unknown>) => void
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
          ...fields,
        })
      )
    }
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') }
}

function defaultWrite(line: string): void {
  process.stdout.write(`${line}\n`)
}
