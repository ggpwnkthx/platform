/**
 * The answers of Access itself.
 *
 * Access refuses a request with a json body that names the error and says what
 * happened. The body of an error of a dependency never reaches a caller.
 */

/** The body of a refusal of Access. */
interface AccessErrorBody {
  error: string
  message: string
  [key: string]: unknown
}

/**
 * Builds the answer of a refusal of Access.
 *
 * The body is `{"error": <code>, "message": <text>}`: the code is the
 * machine readable name of the failure, the text says what happened.
 */
export function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>
): Response {
  const body: AccessErrorBody = { error: code, message, ...extra }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
