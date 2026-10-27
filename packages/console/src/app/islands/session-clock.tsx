/**
 * The clock of the access of the caller to the data.
 *
 * The access token of the access service lives five minutes and there is
 * no refresh token. The clock says how long the access to the data is
 * left, and it offers the renewal when it is over: the renewal is a
 * login, which the provider of the tenant answers without a question
 * when the caller is still signed in there.
 */

import { useEffect, useState } from 'hono/jsx'

function format(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export default function SessionClock(props: { expiresAt: number; renewHref: string }) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // The server does not know the clock of the browser: it renders the
  // link, and the browser turns it into the clock.
  if (now === null) {
    return (
      <a class="badge accent" href={props.renewHref}>
        data access
      </a>
    )
  }
  const left = props.expiresAt - now
  if (left <= 5000) {
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
