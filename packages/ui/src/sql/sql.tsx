import clsx from 'clsx'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { run } from './query.ts'
import { display } from '../format.ts'
import { PgError, type Result } from '@platform/pg-client'
import { describe, useSession } from '../session.tsx'
import { Page } from '../shell.tsx'
import { Badge, Empty, Notice } from '../ui/bits.tsx'
import { Action } from '../ui/button.tsx'
import { RunIcon, SqlIcon } from '../ui/icons.tsx'

interface Ran {
  sql: string
  at: number
  ms: number
  result?: Result
  error?: { title: string; detail?: string; code?: string; position?: number }
}

/** Kept for this page's life only, like the token. */
const history: Ran[] = []

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

export function Sql() {
  const { withReaderDb, refresh } = useSession()
  const { query } = useLocation()
  const [sql, setSql] = useState(
    query.q ?? history[0]?.sql ?? 'SELECT session_user, current_user, now();'
  )
  // A statement chosen from the navigation lands in the editor, ready to run.
  useEffect(() => {
    if (query.q) setSql(query.q)
  }, [query.q])
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const latest = history[0]

  const execute = async () => {
    const text = sql.trim()
    if (!text) return
    setBusy(true)
    const started = performance.now()
    const entry: Ran = { sql: text, at: Date.now(), ms: 0 }
    try {
      entry.result = await withReaderDb((db) => run(db, text))
      // A statement may have changed the model or a right: read the catalog again.
      if (!/^\s*(select|with|show|explain|table|values)\b/i.test(text))
        await refresh().catch(() => undefined)
    } catch (error) {
      entry.error = { ...describe(error) }
      if (error instanceof PgError) {
        entry.error.code = error.code
        entry.error.position = error.position
      }
    } finally {
      entry.ms = Math.round(performance.now() - started)
      history.unshift(entry)
      history.splice(50)
      setBusy(false)
      setTick((n) => n + 1)
    }
  }

  return (
    <Page
      title="SQL"
      icon={<SqlIcon size={22} />}
      subtitle="One statement, run as your own role on a login of your own."
      actions={
        <Action
          label="Run (Ctrl+Enter)"
          icon={<RunIcon size={20} />}
          busy={busy}
          onClick={execute}
        />
      }
      sidebar={
        <div class="side-plain">
          <h2 class="side-heading">This page's history</h2>
          {history.length ? (
            <ol class="history">
              {history.map((h) => (
                <li key={h.at}>
                  <button
                    type="button"
                    class={clsx('history-item', h.error && 'is-refused')}
                    onClick={() => {
                      setSql(h.sql)
                      area.current?.focus()
                    }}
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
      }
    >
      <div class="editor">
        <label class="sr-only" for="sql">
          Statement
        </label>
        <textarea
          id="sql"
          ref={area}
          class="editor-text"
          spellcheck={false}
          value={sql}
          onInput={(e) => setSql(e.currentTarget.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              void execute()
            }
          }}
        />
        <div class="editor-foot">
          <span>
            Ctrl + Enter runs it. A second statement is refused: the protocol takes one at a time.
          </span>
        </div>
      </div>
      {latest && (
        <section class="result" aria-live="polite">
          {latest.error ? (
            <Notice tone="danger" title={latest.error.title}>
              {latest.error.detail}
              {latest.error.position !== undefined && (
                <Caret sql={latest.sql} position={latest.error.position} />
              )}
            </Notice>
          ) : latest.result ? (
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
              {latest.result.fields.length > 0 ? (
                <div class="grid-wrap">
                  <table class="grid">
                    <thead>
                      <tr>
                        {latest.result.fields.map((f, i) => (
                          <th key={i}>{f.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {latest.result.rows.slice(0, 1000).map((row, i) => (
                        <tr key={i}>
                          {latest.result!.fields.map((f, j) => (
                            <td key={j} class="mono">
                              {row[f.name] === null ? (
                                <span class="null">null</span>
                              ) : (
                                display(row[f.name])
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {latest.result.rows.length > 1000 && (
                    <p class="result-more">
                      Showing the first 1,000 of {latest.result.rows.length} rows.
                    </p>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      )}
      {!latest && (
        <Empty icon={<SqlIcon size={28} />} title="Run a statement">
          GRANT, CREATE POLICY, ALTER TABLE and every other statement are checked by the database
          against your role. There is no allowlist and no second opinion.
        </Empty>
      )}
    </Page>
  )
}
