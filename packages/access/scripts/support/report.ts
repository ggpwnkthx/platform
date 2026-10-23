/**
 * The failure of a script of the operator.
 *
 * A script that fails writes one line of json on the error stream and
 * leaves with the code of the failure: the pipeline that runs it reads
 * the line, and not a stack of a promise.
 */

/**
 * The failure of a script, with the message that names it.
 *
 * The message is what the reader of the pipeline sees: it says what the
 * script was doing, and the error says why it could not.
 */
export function failure(message: string): (error: unknown) => never {
  return (error: unknown): never => {
    console.error(JSON.stringify({ level: 'error', msg: message, error: String(error) }))
    process.exit(1)
  }
}
