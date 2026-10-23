/**
 * The browser of the compatibility suite.
 *
 * The suite runs the gateway of the reference, unchanged: the browser
 * that logs in at the gateway is the one of the test, and the session it
 * holds is the cookie of the gateway. The two files of the suite do the
 * same three things — wait for the gateway, log in at it and call it —
 * and they do them here.
 */

/** Waits for a url to answer. */
export async function waitFor(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' })
      if (response.status > 0) return
    } catch {
      // The service is not listening yet.
    }
    await Bun.sleep(50)
  }
  throw new Error(`the service at ${url} did not answer`)
}

/**
 * Logs a browser in at the gateway, and answers its session.
 *
 * The browser follows the redirections of the gateway, keeps the cookies
 * it is given and stops when the gateway answers with the page it asked
 * for: the session is the cookie of the gateway.
 */
export async function login(gatewayUrl: string): Promise<string> {
  const jar = new Map<string, string>()
  const header = (): string =>
    [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
  const capture = (response: Response): void => {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] }
    for (const cookie of headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(';')
      if (!pair) continue
      const index = pair.indexOf('=')
      if (index === -1) continue
      jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
    }
  }

  const start = await fetch(`${gatewayUrl}/auth/login?redirect=%2F`, { redirect: 'manual' })
  capture(start)
  let location = start.headers.get('location') ?? ''
  let callback: Response | null = null
  for (let hop = 0; hop < 10; hop += 1) {
    const response = await fetch(location, {
      redirect: 'manual',
      headers: jar.size > 0 ? { cookie: header() } : undefined,
    })
    capture(response)
    const next = response.headers.get('location')

    if (!next) {
      callback = response
      break
    }
    location = new URL(next, gatewayUrl).toString()
  }
  callback ??= new Response(null, { status: 500 })
  const session = jar.get('gateway_session')
  if (!session) {
    throw new Error(`the login did not create a session: ${callback.status}`)
  }
  return `gateway_session=${session}`
}

/** Calls the gateway with the session of the browser. */
export async function request(
  gatewayUrl: string,
  path: string,
  cookie: string,
  host: string
): Promise<Response> {
  return await fetch(`${gatewayUrl}${path}`, {
    headers: { cookie, host },
    redirect: 'manual',
  })
}
