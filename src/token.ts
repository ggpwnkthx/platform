/**
 * Signs a person in from a terminal with the OAuth device flow (RFC 8628), the same flow psql 18
 * uses, and returns the access token the issuer gives them.
 */
export async function deviceToken(
  issuer: string,
  clientId: string,
  tell: (message: string) => void,
  scope = 'openid email'
): Promise<string> {
  const post = async (url: string, body: Record<string, string>) => {
    const response = await fetch(url, { method: 'POST', body: new URLSearchParams(body) })
    return { ok: response.ok, json: (await response.json()) as Record<string, string | number> }
  }
  const found = await fetch(`${issuer}/.well-known/openid-configuration`)
  if (!found.ok) throw new Error(`${issuer} is not an OpenID Connect issuer (${found.status})`)
  const meta = (await found.json()) as Record<string, string>
  if (!meta.device_authorization_endpoint || !meta.token_endpoint)
    throw new Error(`${issuer} does not offer device authorization`)
  const start = await post(meta.device_authorization_endpoint, { client_id: clientId, scope })
  if (!start.ok) throw new Error(`Sign-in refused: ${start.json.error ?? 'unknown error'}`)
  const { device_code, user_code, verification_uri, verification_uri_complete } = start.json
  tell(`Open ${verification_uri_complete ?? verification_uri} and enter the code ${user_code}`)
  let interval = Number(start.json.interval ?? 5)
  const deadline = Date.now() + Number(start.json.expires_in ?? 300) * 1000
  while (Date.now() < deadline) {
    await Bun.sleep(interval * 1000)
    const poll = await post(meta.token_endpoint, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: String(device_code),
      client_id: clientId,
    })
    if (poll.ok && typeof poll.json.access_token === 'string') return poll.json.access_token
    if (poll.json.error === 'slow_down') interval += 5
    else if (poll.json.error !== 'authorization_pending')
      throw new Error(`Sign-in failed: ${poll.json.error ?? 'unknown error'}`)
  }
  throw new Error('Sign-in was not completed in time')
}
