/**
 * The pieces every page of the console is made of.
 */

import type { Child } from 'hono/jsx'
import { AccessError } from '../../domains/access'
import { LoginError } from '../../domains/authentication'
import { DataError } from '../../domains/data'
import type { ServiceState } from '../../domains/status'
import { UnreachableError } from '../../domains/transport'

/** The head of a page: its title, what it is about and its actions. */
export function PageHead(props: { title: string; lede?: Child; actions?: Child; eyebrow?: Child }) {
  return (
    <header class="page-head">
      {props.eyebrow ? <div class="muted small">{props.eyebrow}</div> : null}
      <div class="page-head-row">
        <h1>{props.title}</h1>
        {props.actions ? <div class="row">{props.actions}</div> : null}
      </div>
      {props.lede ? <p class="lede">{props.lede}</p> : null}
    </header>
  )
}

/** A badge: a short state in colour. */
export function Badge(props: {
  tone?: 'ok' | 'warn' | 'error' | 'accent' | 'neutral'
  plain?: boolean
  children: Child
}) {
  const tone = props.tone && props.tone !== 'neutral' ? props.tone : ''
  return <span class={`badge ${tone} ${props.plain ? 'plain' : ''}`.trim()}>{props.children}</span>
}

/** The badge of the state of a service. */
export function StateBadge(props: { state: ServiceState }) {
  const tones: Record<ServiceState, 'ok' | 'warn' | 'error' | 'neutral'> = {
    up: 'ok',
    degraded: 'warn',
    down: 'error',
    unconfigured: 'neutral',
  }
  const words: Record<ServiceState, string> = {
    up: 'up',
    degraded: 'not ready',
    down: 'down',
    unconfigured: 'not configured',
  }
  return <Badge tone={tones[props.state]}>{words[props.state]}</Badge>
}

/** A notice: the outcome of an act, or a warning. */
export function Notice(props: { tone: 'ok' | 'error' | 'warn'; title?: Child; children?: Child }) {
  return (
    <div class={`notice ${props.tone}`} role={props.tone === 'error' ? 'alert' : 'status'}>
      {props.title ? <strong>{props.title}</strong> : null}
      {props.children ? <div>{props.children}</div> : null}
    </div>
  )
}

/** What a refusal of a service says, as the console shows it. */
export interface RefusalView {
  readonly title: string
  readonly message: string
  readonly code: string | null
  readonly requestId: string | null
  readonly details: readonly { field: string; code: string }[]
  readonly status: number
}

/** Reads the refusal of an error of a service. */
export function refusalOf(error: unknown): RefusalView {
  if (error instanceof DataError) {
    return {
      title: titleOfStatus(error.status, 'the data service'),
      message: error.message,
      code: error.code,
      requestId: error.requestId,
      details: error.details,
      status: error.status,
    }
  }
  if (error instanceof AccessError) {
    return {
      title: titleOfStatus(error.status, 'the access service'),
      message: error.message,
      code: error.code,
      requestId: error.requestId,
      details: [],
      status: error.status,
    }
  }
  if (error instanceof UnreachableError) {
    return {
      title: `The ${error.service} is not reachable`,
      message: error.message,
      code: null,
      requestId: null,
      details: [],
      status: 502,
    }
  }
  if (error instanceof LoginError) {
    return {
      title: 'The sign-in did not complete',
      message: error.message,
      code: error.code,
      requestId: null,
      details: [],
      status: 400,
    }
  }
  return {
    title: 'Something went wrong in the console',
    message: 'The console could not complete the request. The log of the console holds the cause.',
    code: null,
    requestId: null,
    details: [],
    status: 500,
  }
}

function titleOfStatus(status: number, service: string): string {
  if (status === 401) return `${capitalize(service)} did not recognise you`
  if (status === 403) return `${capitalize(service)} refused the request`
  if (status === 404) return 'There is nothing here'
  if (status === 409 || status === 412) return 'It changed in the meantime'
  if (status === 422 || status === 400) return `${capitalize(service)} did not accept the request`
  if (status === 429) return 'Too many requests'
  if (status >= 500) return `${capitalize(service)} could not answer`
  return `${capitalize(service)} refused the request`
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** A refusal of a service, shown as it is. */
export function Refusal(props: { refusal: RefusalView; children?: Child }) {
  const { refusal } = props
  return (
    <div class="notice error" role="alert">
      <strong>{refusal.title}</strong>
      <span>{refusal.message}</span>
      {refusal.details.length > 0 ? (
        <ul class="small">
          {refusal.details.map((detail) => (
            <li>
              <code>{detail.field}</code>: {detail.code}
            </li>
          ))}
        </ul>
      ) : null}
      {refusal.code || refusal.requestId ? (
        <span class="small muted">
          {refusal.code ? (
            <>
              code <code>{refusal.code}</code>
            </>
          ) : null}
          {refusal.code && refusal.requestId ? ' · ' : null}
          {refusal.requestId ? (
            <>
              request <code>{refusal.requestId}</code>
            </>
          ) : null}
        </span>
      ) : null}
      {props.children}
    </div>
  )
}

/** A list that holds nothing. */
export function Empty(props: { children: Child }) {
  return <div class="empty">{props.children}</div>
}

/** The tabs of a section. */
export function Tabs(props: {
  items: readonly { href: string; label: string; current?: boolean }[]
}) {
  return (
    <nav class="tabs" aria-label="Sections">
      {props.items.map((item) => (
        <a href={item.href} aria-current={item.current ? 'page' : undefined}>
          {item.label}
        </a>
      ))}
    </nav>
  )
}

/** The pages of an offset list. */
export function OffsetPager(props: {
  total: number
  limit: number
  offset: number
  href: (offset: number) => string
}) {
  const { total, limit, offset } = props
  const first = total === 0 ? 0 : offset + 1
  const last = Math.min(total, offset + limit)
  return (
    <div class="pager">
      <span class="muted">
        {first}–{last} of {total}
      </span>
      <span class="row">
        {offset > 0 ? (
          <a class="button quiet small" href={props.href(Math.max(0, offset - limit))}>
            Previous
          </a>
        ) : null}
        {last < total ? (
          <a class="button quiet small" href={props.href(offset + limit)}>
            Next
          </a>
        ) : null}
      </span>
    </div>
  )
}

/** A moment, as the reader reads it: the date, the time, and the zone. */
export function Moment(props: { at: string | null | undefined }) {
  if (!props.at) return <span class="muted">—</span>
  const date = new Date(props.at)
  if (Number.isNaN(date.getTime())) return <span>{props.at}</span>
  const text = `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
  return (
    <time datetime={date.toISOString()} class="nowrap">
      {text}
    </time>
  )
}

/** A list of definitions. */
export function KeyValues(props: { rows: readonly [Child, Child][] }) {
  return (
    <dl class="kv">
      {props.rows.map(([key, value]) => (
        <>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </>
      ))}
    </dl>
  )
}
