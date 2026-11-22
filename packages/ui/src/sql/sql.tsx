import { useEffect, useRef, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { run } from './query.ts'
import { useSession } from '../session.tsx'
import { Page } from '../shell/page.tsx'
import { Empty } from '../ui/bits.tsx'
import { Action } from '../ui/button.tsx'
import { RunIcon, SqlIcon } from '../ui/icons.tsx'
import { errorOf, History, type Ran, ResultView } from './result.tsx'

/** Kept for this page's life only, like the token. */
const history: Ran[] = []

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
      entry.error = errorOf(error)
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
        <History
          history={history}
          onChoose={(text) => {
            setSql(text)
            area.current?.focus()
          }}
        />
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
          <ResultView latest={latest} />
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
