import clsx from 'clsx'
import { PgError, type Result } from '@platform/pg-client'
import { display } from '../format.ts'
import { describe } from '../session.tsx'
import { Badge, Notice } from '../ui/bits.tsx'

/** A statement this page has run, and what the database made of it. */
export interface Ran {
  sql: string
  at: number
  ms: number
  result?: Result
  error?: { title: string; detail?: string; code?: string; position?: number }
}

/** The place in the statement the database refused, shown where it is. */
function Caret({ sql, position }: { sql: string; position: number }) {
  const before = sql.slice(0, position - 1)
  const line = before.split('\n').length
  const lineStart = before.lastIndexOf('\n') + 1
  const text = sql.split('\n')[line - 1] ?? ''
  const column = position - 1 - lineStart
  return (
    <pre class="caret">
      <code>
        {line > 1 ? `line ${line}: ` : ''}
        {text}
        {'\n'}
        {' '.repeat(column + (line > 1 ? `line ${line}: `.length : 0))}^
      </code>
    </pre>
  )
}

/** The rows the statement returned, drawn as a table. */
function ResultTable({ result }: { result: Result }) {
  return (
    <div class="grid-wrap">
      <table class="grid">
        <thead>
          <tr>
            {result.fields.map((f, i) => (
              <th key={i}>{f.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.slice(0, 1000).map((row, i) => (
            <tr key={i}>
              {result.fields.map((f, j) => (
                <td key={j} class="mono">
                  {row[f.name] === null ? <span class="null">null</span> : display(row[f.name])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length > 1000 && (
        <p class="result-more">Showing the first 1,000 of {result.rows.length} rows.</p>
      )}
    </div>
  )
}

/** What the last statement made of itself: its rows, or what the database refused. */
export function ResultView({ latest }: { latest: Ran }) {
  if (latest.error)
    return (
      <Notice tone="danger" title={latest.error.title}>
        {latest.error.detail}
        {latest.error.position !== undefined && (
          <Caret sql={latest.sql} position={latest.error.position} />
        )}
      </Notice>
    )
  if (!latest.result) return null
  return (
    <>
      <p class="result-head">
        <Badge tone="success">{latest.result.command || 'OK'}</Badge>
        <span>
          {latest.result.affected !== null
            ? `${latest.result.affected} ${latest.result.command === 'SELECT' ? 'rows' : 'rows affected'}`
            : 'Done'}{' '}
          · {latest.ms} ms
        </span>
      </p>
      {latest.result.fields.length > 0 ? <ResultTable result={latest.result} /> : null}
    </>
  )
}

/** What the history of this page holds: the statements run, and how they fared. */
export function History({
  history,
  onChoose,
}: {
  history: Ran[]
  onChoose: (sql: string) => void
}) {
  return (
    <div class="side-plain">
      <h2 class="side-heading">This page's history</h2>
      {history.length ? (
        <ol class="history">
          {history.map((h) => (
            <li key={h.at}>
              <button
                type="button"
                class={clsx('history-item', h.error && 'is-refused')}
                onClick={() => onChoose(h.sql)}
              >
                <code>{h.sql}</code>
                <span>
                  {h.error ? (
                    <Badge tone="danger">{h.error.code ?? 'failed'}</Badge>
                  ) : (
                    <Badge tone="success">{h.result?.command || 'OK'}</Badge>
                  )}
                  <small>{h.ms} ms</small>
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p class="side-note">
          Statements you run appear here until you leave the page. Nothing is stored.
        </p>
      )}
    </div>
  )
}

/** The error the database gave, in the words the database gave. */
export function errorOf(error: unknown): Ran['error'] {
  const said: NonNullable<Ran['error']> = { ...describe(error) }
  if (error instanceof PgError) {
    said.code = error.code
    said.position = error.position
  }
  return said
}
