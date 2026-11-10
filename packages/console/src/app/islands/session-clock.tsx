/**
 * The clock of the access of the caller to the data.
 *
 * The access token of Access lives five minutes and the console renews
 * it on the server, with the refresh token of the login. The clock says
 * how long the access to the data is left, and it asks the console to
 * renew it before the token dies.
 *
 * The renewal is the ordinary work of the console: the browser asks the
 * console, the console renews the token with Access, and the browser is
 * told when the new token expires. A session that cannot renew itself
 * offers the sign-in again.
 */

import { useEffect, useRef, useState } from 'hono/jsx'

/** How long before the expiry of the token the browser asks for a renewal. */
const RENEW_AT_MS = 45_000

/** The answer of the renewal of the console. */
interface Renewal {
  /** The moment the new token expires, in milliseconds. */
  expiresAt: number
  /** Whether the session can renew itself. */
  renewable: boolean
}

function format(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Asks the console to renew the token of the session. */
async function renew(): Promise<Renewal | null> {
  try {
    const response = await fetch('/auth/renew', {
      method: 'POST',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return null
    const body = (await response.json()) as Partial<Renewal>
    if (typeof body.expiresAt !== 'number') return null
    return { expiresAt: body.expiresAt, renewable: body.renewable !== false }
  } catch {
    return null
  }
}

export default function SessionClock(props: { expiresAt: number; renewHref: string }) {
  const [now, setNow] = useState<number | null>(null)
  const [expiresAt, setExpiresAt] = useState(props.expiresAt)
  const [renewable, setRenewable] = useState(true)
  // The expiry the browser already asked for: the console is asked once
  // for a token, and not again for the same one.
  const asked = useRef<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (now === null) return
    if (expiresAt - now > RENEW_AT_MS) return
    if (asked.current === expiresAt) return
    asked.current = expiresAt
    void renew().then((answer) => {
      if (!answer) {
        setRenewable(false)
        return
      }
      setExpiresAt(answer.expiresAt)
      setRenewable(answer.renewable)
    })
  }, [now, expiresAt])

  // The server does not know the clock of the browser: it renders the
  // link, and the browser turns it into the clock.
  if (now === null) {
    return (
      <a class="badge accent" href={props.renewHref}>
        data access
      </a>
    )
  }
  const left = expiresAt - now
  if (!renewable || left <= 5000) {
    return (
      <a
        class="badge warn"
        href={`${props.renewHref}${encodeURIComponent(location.pathname + location.search)}`}
        title="Your access to the data expired: renew it"
      >
        renew data access
      </a>
    )
  }
  return (
    <span
      class={`badge ${left < 60_000 ? 'warn' : 'ok'}`}
      title="How long your access to the data is left before it is renewed"
    >
      data access {format(left)}
    </span>
  )
}
