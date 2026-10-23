/**
 * The client of the tests of the http surface.
 *
 * A test of the contract calls the service over http, with the token of
 * the administration or the token of the decisions. The call is the same
 * in every file of the suite: it lives here, once, and the file of the
 * test says what is specific to it.
 */

/** The answer of the service to a call of a test. */
interface TestResponse {
  /** The status of the answer. */
  status: number
  /** The body of the answer, when it is json. */
  body: Record<string, unknown>
  /** The body of the answer, as it was written. */
  text: string
}

/** The options of a call of a test. */
interface CallOptions {
  /** The method of the call. */
  method: string
  /** The body of the call. */
  body?: Record<string, unknown> | undefined
  /** The headers of the call. */
  headers?: Record<string, string>
}

/** The client of the service under test. */
export interface TestClient {
  /** The url the callers reach the service at. */
  base: string
  /** A call with the headers the caller chooses. */
  request: (path: string, options: CallOptions) => Promise<TestResponse>
  /** A call that answers the status and the body of the answer. */
  call: (
    path: string,
    method: string,
    body?: Record<string, unknown>,
    token?: string | null
  ) => Promise<TestResponse>
  /** A call that answers the body of the answer. */
  json: (
    path: string,
    method: string,
    body?: Record<string, unknown>,
    token?: string | null
  ) => Promise<Record<string, unknown>>
  /** A call that fails when the answer of the service is not a success. */
  strict: (
    path: string,
    method: string,
    body?: Record<string, unknown>,
    token?: string | null
  ) => Promise<void>
  /**
   * A decision of the gateway.
   *
   * The header of authorization is the one the gateway presents: a
   * bearer token of the deployment, or the credentials of a tenant. A
   * null header is a call without a credential.
   */
  decide: (body: Record<string, unknown>, authorization?: string | null) => Promise<TestResponse>
}

/**
 * The cookie of an answer, as the browser would keep it.
 *
 * The browser keeps the name and the value of the cookie and drops the
 * attributes of the `set-cookie`: the session is the pair, and the pair
 * is what the next call presents.
 */
export function cookieOf(response: Response): string {
  const header = response.headers.get('set-cookie') ?? ''
  return header.split(';')[0] ?? ''
}

/** Reads the body of an answer of the service. */
function readBody(text: string): Record<string, unknown> {
  if (!text) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

/**
 * The client of the service under test.
 *
 * The token of the client is the token of the administration: a call that
 * needs another token names it, and a call that needs no token at all
 * names null.
 */
export function createTestClient(base: string, token: string | null = null): TestClient {
  const request = async (path: string, options: CallOptions): Promise<TestResponse> => {
    // The headers are the ones of the caller: a call that needs no
    // credential at all names none, and the client never adds one.
    // A call that reads carries no body: a GET with a body is not a
    // request that a server answers the same way.
    const method = options.method.toUpperCase()
    const carriesBody = options.body !== undefined && method !== 'GET' && method !== 'HEAD'
    const headers: Record<string, string> = { ...options.headers }
    if (carriesBody) headers['content-type'] = 'application/json'
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      ...(carriesBody ? { body: JSON.stringify(options.body) } : {}),
    })
    const text = await response.text()
    return { status: response.status, body: readBody(text), text }
  }

  const call = async (
    path: string,
    method: string,
    body?: Record<string, unknown>,
    callToken: string | null = token
  ): Promise<TestResponse> => {
    const headers: Record<string, string> = {}
    if (callToken !== null) headers.authorization = `Bearer ${callToken}`
    return await request(path, { method, body, headers })
  }

  return {
    base,
    request,
    call,
    json: async (path, method, body, callToken = token) => {
      const answer = await call(path, method, body, callToken)
      return answer.body
    },
    strict: async (path, method, body, callToken = token) => {
      const answer = await call(path, method, body, callToken)
      if (answer.status < 200 || answer.status >= 300) {
        throw new Error(`the service answered ${answer.status}: ${answer.text}`)
      }
    },
    decide: async (body, authorization = null) =>
      await request('/v1/decisions', {
        method: 'POST',
        body,
        ...(authorization === null ? {} : { headers: { authorization } }),
      }),
  }
}
