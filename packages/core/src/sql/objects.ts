import { id, InvalidName, sql, stmt } from './kit.ts'

/**
 * What a schema holds beside its tables: views, functions and procedures, triggers,
 * sequences and extensions. A body, a query or a condition is the owner's own SQL, written as it
 * is; PostgreSQL parses the statement, and runs one statement only, so it is the judge of it.
 */
const named = (name: unknown, what: string) => {
  const text = String(name ?? '').trim()
  if (!text) throw new InvalidName(`Name the ${what}.`)
  return text
}
const body = (text: unknown, what: string) => {
  const out = String(text ?? '')
    .trim()
    .replace(/;\s*$/, '')
  if (!out) throw new InvalidName(`Write the ${what}.`)
  return out
}

/**
 * A view: a query kept under a name. It reads as its caller (security_invoker) unless the
 * owner says otherwise, so a reader meets the row policies and grants of what it reads: a view
 * that reads as its owner shows every reader what its owner may read. A materialized view keeps
 * its rows as its owner read them when it was last refreshed, and has no row security of its own.
 */
export interface ViewDraft {
  schema: string
  name: string
  query: string
  materialized?: boolean
  /** On by default: the reader's own rights apply to what the view reads. */
  securityInvoker?: boolean
  replace?: boolean
}
export function viewStatement(draft: ViewDraft) {
  const name = id(draft.schema, named(draft.name, 'view'))
  const query = sql.raw(body(draft.query, 'query'))
  if (draft.materialized) return stmt`CREATE MATERIALIZED VIEW ${name} AS ${query}`
  return stmt`CREATE ${sql.raw(draft.replace ? 'OR REPLACE ' : '')}VIEW ${name} WITH (security_invoker = ${sql.raw(
    draft.securityInvoker === false ? 'false' : 'true'
  )}) AS ${query}`
}
export const refreshViewStatement = (schema: string, name: string) =>
  stmt`REFRESH MATERIALIZED VIEW ${id(schema, name)}`
export const viewInvokerStatement = (schema: string, name: string, invoker: boolean) =>
  stmt`ALTER VIEW ${id(schema, name)} SET (security_invoker = ${sql.raw(String(invoker))})`

export const routineKinds = ['function', 'procedure'] as const
export const volatilities = ['volatile', 'stable', 'immutable'] as const
export interface RoutineDraft {
  schema: string
  name: string
  kind: (typeof routineKinds)[number]
  /** As PostgreSQL writes them: `a integer, b text DEFAULT ''`. */
  arguments?: string
  /** A function's result type: `integer`, `trigger`, `TABLE (id uuid, name text)`. */
  returns?: string
  language: string
  body: string
  volatility?: (typeof volatilities)[number]
  /**
   * Runs with its owner's rights rather than its caller's. Its search path is then fixed to
   * PostgreSQL's own catalog, so a caller cannot put a table or a function of their own in the
   * way of a name the body uses: the body names everything with its schema.
   */
  securityDefiner?: boolean
  replace?: boolean
}
/** A dollar quote no line of the body could close. */
function quoted(text: string) {
  let tag = 'body'
  while (text.includes(`$${tag}$`)) tag += '_'
  return sql.raw(`$${tag}$\n${text}\n$${tag}$`)
}
export function routineStatement(draft: RoutineDraft) {
  const kind = routineKinds.includes(draft.kind) ? draft.kind : 'function'
  const language = named(draft.language, 'language')
  if (!/^[a-z_][a-z0-9_]*$/i.test(language)) throw new InvalidName(`${language} is not a language`)
  const returns =
    kind === 'function' ? sql` RETURNS ${sql.raw(body(draft.returns, 'result type'))}` : sql.raw('')
  const volatility =
    kind === 'function' && draft.volatility && volatilities.includes(draft.volatility)
      ? ` ${draft.volatility.toUpperCase()}`
      : ''
  const definer = draft.securityDefiner
    ? ' SECURITY DEFINER SET search_path = pg_catalog, pg_temp'
    : ''
  return stmt`CREATE ${sql.raw(draft.replace ? 'OR REPLACE ' : '')}${sql.raw(kind.toUpperCase())} ${id(
    draft.schema,
    named(draft.name, kind)
  )}(${sql.raw(String(draft.arguments ?? '').trim())})${returns} LANGUAGE ${sql.raw(language)}${sql.raw(
    volatility + definer
  )} AS ${quoted(body(draft.body, 'body'))}`
}
/** A routine named by its signature, as the catalog writes it: `newsroom.word_count(text)`. */
export const dropRoutineStatement = (signature: string, kind = 'function') =>
  stmt`DROP ${sql.raw(kind === 'procedure' ? 'PROCEDURE' : 'FUNCTION')} ${sql.raw(body(signature, 'signature'))}`

export const triggerTimings = ['BEFORE', 'AFTER', 'INSTEAD OF'] as const
export const triggerEvents = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] as const
export interface TriggerDraft {
  schema: string
  table: string
  name: string
  timing: (typeof triggerTimings)[number]
  events: string[]
  /** Once for each row, or once for each statement. */
  row: boolean
  /** The trigger function, by its signature: `newsroom.touch()`. */
  function: string
  when?: string
}
export function triggerStatement(draft: TriggerDraft) {
  if (!triggerTimings.includes(draft.timing)) throw new InvalidName('Say when it fires.')
  const events = (draft.events ?? []).filter((e) =>
    (triggerEvents as readonly string[]).includes(e)
  )
  if (!events.length) throw new InvalidName('Choose what it fires on.')
  const fn = body(draft.function, 'trigger function').replace(/\(.*\)$/, '')
  const when = draft.when?.trim()
  return stmt`CREATE TRIGGER ${id(named(draft.name, 'trigger'))} ${sql.raw(draft.timing)} ${sql.raw(
    events.join(' OR ')
  )} ON ${id(draft.schema, draft.table)} FOR EACH ${sql.raw(draft.row ? 'ROW' : 'STATEMENT')}${sql.raw(
    when ? ` WHEN (${when})` : ''
  )} EXECUTE FUNCTION ${sql.raw(fn)}()`
}
export const dropTriggerStatement = (schema: string, table: string, name: string) =>
  stmt`DROP TRIGGER ${id(name)} ON ${id(schema, table)}`
export const enableTriggerStatement = (schema: string, table: string, name: string, on: boolean) =>
  stmt`ALTER TABLE ${id(schema, table)} ${sql.raw(on ? 'ENABLE' : 'DISABLE')} TRIGGER ${id(name)}`
export const renameTriggerStatement = (schema: string, table: string, from: string, to: string) =>
  stmt`ALTER TRIGGER ${id(from)} ON ${id(schema, table)} RENAME TO ${id(named(to, 'trigger'))}`

export interface SequenceDraft {
  schema: string
  name: string
  type?: 'smallint' | 'integer' | 'bigint'
  start?: number | null
  increment?: number | null
  minimum?: number | null
  maximum?: number | null
  cycle?: boolean
}
const whole = (value: unknown, what: string) => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isSafeInteger(n)) throw new InvalidName(`${what} is a whole number`)
  return n
}
function sequenceWords(draft: Omit<SequenceDraft, 'schema' | 'name'>, restart = false) {
  const words: string[] = []
  if (draft.type)
    words.push(
      `AS ${['smallint', 'integer', 'bigint'].includes(draft.type) ? draft.type : 'bigint'}`
    )
  const add = (word: string, value: unknown, what: string) => {
    const n = whole(value, what)
    if (n !== null) words.push(`${word} ${n}`)
  }
  add('INCREMENT BY', draft.increment, 'The step')
  add('MINVALUE', draft.minimum, 'The least value')
  add('MAXVALUE', draft.maximum, 'The greatest value')
  add(restart ? 'RESTART WITH' : 'START WITH', draft.start, 'The start')
  if (draft.cycle !== undefined) words.push(draft.cycle ? 'CYCLE' : 'NO CYCLE')
  return words.join(' ')
}
export const sequenceStatement = (draft: SequenceDraft) =>
  stmt`CREATE SEQUENCE ${id(draft.schema, named(draft.name, 'sequence'))}${sql.raw(
    sequenceWords(draft) ? ` ${sequenceWords(draft)}` : ''
  )}`
export function alterSequenceStatement(
  schema: string,
  name: string,
  draft: Omit<SequenceDraft, 'schema' | 'name'>
) {
  const words = sequenceWords(draft, true)
  return words ? stmt`ALTER SEQUENCE ${id(schema, name)} ${sql.raw(words)}` : null
}
export const dropSequenceStatement = (schema: string, name: string) =>
  stmt`DROP SEQUENCE ${id(schema, name)}`
