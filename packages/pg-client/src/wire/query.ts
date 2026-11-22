import { Writer, encoder } from './codec.ts'
import { serialize } from './codec.ts'

/**
 * The messages of one statement, as they go on the wire: the statement is parsed, the values
 * are bound separately, and the row shape is asked for. The statement is never interpolated:
 * every value travels separately, so a value can never change what the statement does.
 */
export function queryMessages(text: string, params: unknown[]): Uint8Array {
  const bind = new Writer().cstring('').cstring('').int16(0).int16(params.length)
  for (const param of params) {
    const value = serialize(param)
    if (value === null) bind.int32(-1)
    else {
      const bytes = encoder.encode(value)
      bind.int32(bytes.length).bytes(bytes)
    }
  }
  bind.int16(0)
  const messages = [
    new Writer().cstring('').cstring(text).int16(0).frame('P'),
    bind.frame('B'),
    new Writer().bytes(encoder.encode('P')).cstring('').frame('D'),
    new Writer().cstring('').int32(0).frame('E'),
    new Writer().frame('S'),
  ]
  const total = messages.reduce((sum, m) => sum + m.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const m of messages) {
    out.set(m, at)
    at += m.length
  }
  return out
}
