import { serialize as protocol } from 'pg-protocol'
import { serialize } from './codec.ts'

/**
 * The messages of one statement, as they go on the wire: the statement is parsed, the values
 * are bound separately, and the row shape is asked for. The statement is never interpolated:
 * every value travels separately, so a value can never change what the statement does.
 */
export function queryMessages(text: string, params: unknown[]): Uint8Array {
  const messages = [
    protocol.parse({ text }),
    protocol.bind({ values: params.map((value) => serialize(value)) }),
    protocol.describe({ type: 'P' }),
    protocol.execute(),
    protocol.sync(),
  ]
  return Buffer.concat(messages)
}
