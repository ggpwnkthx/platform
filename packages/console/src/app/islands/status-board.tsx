/**
 * The board of the status of the services.
 *
 * The server renders the probes it read; the board reads them again
 * every few seconds, and it draws the latency of every service over the
 * minutes the page has been open.
 */

import { useEffect, useState } from 'hono/jsx'
import type { ServiceState, ServiceStatus } from '../../domains/status'

interface Board {
  readonly overall: ServiceState
  readonly services: readonly ServiceStatus[]
  readonly detail: boolean
}

const WORDS: Record<ServiceState, string> = {
  up: 'up',
  degraded: 'not ready',
  down: 'down',
  unconfigured: 'not configured',
}

const TONES: Record<ServiceState, string> = {
  up: 'ok',
  degraded: 'warn',
  down: 'error',
  unconfigured: '',
}

const HEADLINES: Record<ServiceState, string> = {
  up: 'Every service answers and is ready',
  degraded: 'A service answers but is not ready',
  down: 'A service does not answer',
  unconfigured: 'No service is configured',
}

const KEEP = 40

function Spark(props: { points: readonly number[] }) {
  if (props.points.length < 2) return <svg class="spark" aria-hidden="true" />
  const max = Math.max(...props.points, 1)
  const step = 100 / (KEEP - 1)
  const offset = (KEEP - props.points.length) * step
  const line = props.points
    .map(
      (point, index) =>
        `${(offset + index * step).toFixed(2)},${(30 - (point / max) * 28).toFixed(2)}`
    )
    .join(' ')
  return (
    <svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={line} />
    </svg>
  )
}

function Probe(props: { label: string; answer: ServiceStatus['health'] }) {
  const answer = props.answer
  if (!answer) return null
  return (
    <details class="disclosure small">
      <summary>
        {props.label}: {answer.status ?? 'no answer'} · {answer.latencyMs} ms
      </summary>
      <pre>{answer.error ?? JSON.stringify(answer.body, null, 2)}</pre>
    </details>
  )
}

export default function StatusBoard(props: {
  initial: Board
  endpoint: string
  intervalMs: number
}) {
  const [board, setBoard] = useState<Board>(props.initial)
  const [history, setHistory] = useState<Record<string, number[]>>({})
  const [paused, setPaused] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (paused) return
    let stopped = false
    const read = async () => {
      try {
        const response = await fetch(props.endpoint, { headers: { accept: 'application/json' } })
        if (!response.ok) throw new Error(String(response.status))
        const next = (await response.json()) as Board
        if (stopped) return
        setBoard(next)
        setFailed(false)
        setHistory((previous) => {
          const updated: Record<string, number[]> = { ...previous }
          for (const service of next.services) {
            const latency = Math.max(service.health?.latencyMs ?? 0, service.ready?.latencyMs ?? 0)
            updated[service.id] = [...(previous[service.id] ?? []), latency].slice(-KEEP)
          }
          return updated
        })
      } catch {
        if (!stopped) setFailed(true)
      }
    }
    void read()
    const timer = setInterval(read, props.intervalMs)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [paused])

  const checked = board.services[0]?.checkedAt
  return (
    <section class="stack" aria-live="polite">
      <div class="card">
        <header>
          <div class="row">
            <span class={`status-dot ${board.overall}`} />
            <h2>{HEADLINES[board.overall]}</h2>
          </div>
          <div class="row small muted">
            {failed ? <span class="badge error">the console could not read the probes</span> : null}
            {checked ? (
              <span>checked {new Date(checked).toISOString().slice(11, 19)} UTC</span>
            ) : null}
            <button type="button" class="button quiet small" onClick={() => setPaused(!paused)}>
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </header>
      </div>
      <div class="grid">
        {board.services.map((service) => (
          <article class="card">
            <header>
              <h3>{service.name}</h3>
              <span class={`badge ${TONES[service.state]}`}>{WORDS[service.state]}</span>
            </header>
            {board.detail ? (
              <>
                <dl class="kv small">
                  <dt>version</dt>
                  <dd>{service.version ?? '—'}</dd>
                  <dt>latency</dt>
                  <dd>
                    {service.health
                      ? `${Math.max(service.health.latencyMs, service.ready?.latencyMs ?? 0)} ms`
                      : '—'}
                  </dd>
                </dl>
                <Spark points={history[service.id] ?? []} />
                <Probe label="healthz" answer={service.health} />
                <Probe label="readyz" answer={service.ready} />
              </>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}
