import { type DatabaseError, serialize as protocol } from 'pg-protocol'
import type {
  BackendMessage,
  CommandCompleteMessage,
  DataRowMessage,
  ParameterStatusMessage,
  RowDescriptionMessage,
} from 'pg-protocol/dist/messages'
import { ConnectionError, PgError } from './errors.ts'
import { kvsep, parseValue } from './codec.ts'
import type { Session } from './types.ts'

/**
 * What the server said, and what the session does with it.
 *
 * The messages are the protocol's own, read by `pg-protocol`: what is here is the session's
 * own reading of them — what a statement is answered with, what a refusal is, and what the
 * server said of itself when it logged in.
 */
export function handle(session: Session, message: BackendMessage): void {
  switch (message.name) {
    case 'authenticationSASL':
      sasl(session, (message as unknown as { mechanisms: string[] }).mechanisms)
      return
    case 'authenticationSASLContinue':
      // The server describes why it refused the token; acknowledging lets it send the error.
      session.transport.send(protocol.sendSCRAMClientFinalMessage(kvsep))
      return
    case 'parameterStatus': {
      const said = message as ParameterStatusMessage
      session.parameters.set(said.parameterName, said.parameterValue)
      return
    }
    case 'readyForQuery':
      readyForQuery(session)
      return
    case 'rowDescription':
      rowDescription(session, message as RowDescriptionMessage)
      return
    case 'dataRow':
      dataRow(session, message as DataRowMessage)
      return
    case 'commandComplete':
      commandComplete(session, (message as CommandCompleteMessage).text)
      return
    case 'error':
      errorResponse(session, asPgError(message as DatabaseError))
      return
    default:
      // The rest are the server's own housekeeping: notices, notifications, the keys of
      // the session and the acknowledgements of the steps of a statement.
      return
  }
}

/**
 * The sign-in: the server names the mechanisms it accepts, and the token is offered as the
 * one of them that carries a bearer token. A password, in any form, is never sent: the page
 * holds none.
 */
function sasl(session: Session, mechanisms: string[]): void {
  if (!mechanisms.includes('OAUTHBEARER'))
    throw new ConnectionError('PostgreSQL does not accept a sign-in token for this role')
  const response = `n,,${kvsep}auth=Bearer ${session.options.token}${kvsep}${kvsep}`
  session.transport.send(protocol.sendSASLInitialResponseMessage('OAUTHBEARER', response))
}

/** The statement is done: what it answered is given to whoever asked for it. */
function readyForQuery(session: Session): void {
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

/** The server refused: the statement that was running is refused with it. */
function errorResponse(session: Session, error: PgError): void {
  const pending = session.queue[0]
  if (session.ready || !pending) {
    // An error during the login, or outside any statement: the server ends the session.
    session.end(error)
    return
  }
  pending.error = error
}

/** The shape of the rows that are coming: the name and the type of every column. */
function rowDescription(session: Session, message: RowDescriptionMessage): void {
  const pending = session.queue[0]
  if (!pending) return
  pending.fields = message.fields.map((field) => ({
    name: field.name,
    type: field.dataTypeID,
    table: field.tableID,
    column: field.columnID,
  }))
}

/** One row of the answer, read as the type each column is. */
function dataRow(session: Session, message: DataRowMessage): void {
  const pending = session.queue[0]
  if (!pending) return
  const row: Record<string, unknown> = {}
  message.fields.forEach((value, index) => {
    const field = pending.fields[index]
    const name = field?.name ?? `?column${index}?`
    row[name] = value === null ? null : parseValue(field?.type ?? 25, value)
  })
  pending.rows.push(row)
}

/** The command the statement was: its verb, and the rows it changed. */
function commandComplete(session: Session, tag: string): void {
  const pending = session.queue[0]
  if (!pending) return
  const parts = tag.split(' ')
  const last = parts[parts.length - 1]
  const numeric = last !== undefined && /^\d+$/.test(last)
  pending.command = (numeric ? parts.slice(0, parts[0] === 'INSERT' ? -2 : -1) : parts).join(' ')
  pending.affected = numeric ? Number(last) : null
}

/** The server's refusal, in the shape the platform's own errors take. */
function asPgError(error: DatabaseError): PgError {
  const fields = new Map<string, string>()
  fields.set('M', error.message)
  fields.set('C', error.code ?? '')
  fields.set('S', error.severity ?? 'ERROR')
  if (error.detail) fields.set('D', error.detail)
  if (error.hint) fields.set('H', error.hint)
  if (error.position) fields.set('P', error.position)
  if (error.schema) fields.set('s', error.schema)
  if (error.table) fields.set('t', error.table)
  if (error.column) fields.set('c', error.column)
  if (error.constraint) fields.set('n', error.constraint)
  return new PgError(fields)
}
