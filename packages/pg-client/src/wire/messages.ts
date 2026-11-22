import { ConnectionError } from './errors.ts'
import type { PgError } from './errors.ts'
import { type Reader, Writer, decoder, encoder, kvsep } from './codec.ts'
import { parseValue } from './codec.ts'
import type { Session } from './types.ts'

export function authentication(session: Session, body: Reader) {
  const code = body.int32()
  if (code === 0) return
  if (code === 10) {
    const mechanisms: string[] = []
    for (let name = body.cstring(); name; name = body.cstring()) mechanisms.push(name)
    if (!mechanisms.includes('OAUTHBEARER'))
      throw new ConnectionError('PostgreSQL does not accept a sign-in token for this role')
    const response = encoder.encode(
      `n,,${kvsep}auth=Bearer ${session.options.token}${kvsep}${kvsep}`
    )
    session.transport.send(
      new Writer().cstring('OAUTHBEARER').int32(response.length).bytes(response).frame('p')
    )
    return
  }
  if (code === 11) {
    // The server describes why it refused the token; acknowledging lets it send the error.
    session.transport.send(new Writer().bytes(encoder.encode(kvsep)).frame('p'))
    return
  }
  if (code === 12) return
  // A password, in any form, is never sent: the page holds none.
  throw new ConnectionError('PostgreSQL asked for a password. Only a sign-in token is sent.')
}

export function readyForQuery(session: Session) {
  if (session.closed) return
  if (session.ready) {
    const ready = session.ready
    session.ready = null
    session.failed = null
    ready()
    return
  }
  const pending = session.queue.shift()
  if (!pending) return
  if (pending.error) pending.reject(pending.error)
  else
    pending.resolve({
      fields: pending.fields,
      rows: pending.rows,
      command: pending.command,
      affected: pending.affected,
    })
}

export function errorResponse(session: Session, error: PgError) {
  const pending = session.queue[0]
  if (session.ready || !pending) {
    // An error during the login, or outside any statement: the server ends the session.
    session.end(error)
    return
  }
  pending.error = error
}

export function rowDescription(session: Session, body: Reader) {
  const pending = session.queue[0]
  if (!pending) return
  const count = body.int16()
  pending.fields = []
  for (let i = 0; i < count; i++) {
    const name = body.cstring()
    const table = body.int32()
    const column = body.int16()
    const type = body.int32()
    body.int16()
    body.int32()
    body.int16()
    pending.fields.push({ name, type, table, column })
  }
}

export function dataRow(session: Session, body: Reader) {
  const pending = session.queue[0]
  if (!pending) return
  const count = body.int16()
  const row: Record<string, unknown> = {}
  for (let i = 0; i < count; i++) {
    const length = body.int32()
    const field = pending.fields[i]
    const name = field?.name ?? `?column${i}?`
    row[name] =
      length === -1 ? null : parseValue(field?.type ?? 25, decoder.decode(body.take(length)))
  }
  pending.rows.push(row)
}

export function commandComplete(session: Session, tag: string) {
  const pending = session.queue[0]
  if (!pending) return
  const parts = tag.split(' ')
  const last = parts[parts.length - 1]
  const numeric = last !== undefined && /^\d+$/.test(last)
  pending.command = (numeric ? parts.slice(0, parts[0] === 'INSERT' ? -2 : -1) : parts).join(' ')
  pending.affected = numeric ? Number(last) : null
}
