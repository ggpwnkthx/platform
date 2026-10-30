/**
 * The transport of the clients of the platform, for the CLI.
 *
 * The clients of the platform (`@platform/client`) speak with a port of
 * their own: this is the adapter that answers it with the transport of
 * the CLI.
 *
 * The credential of the CLI travels in its own field of the request and
 * not in a header: the transport of the CLI is the one that holds it and
 * the one that writes it in the headers of the call.
 */

import type { ClientTransport } from '@platform/client'
import type { HttpPort } from './contracts'

/**
 * The transport of the clients of the platform.
 *
 * @param http the transport of the CLI.
 */
export function transportOf(http: HttpPort): ClientTransport {
  return {
    send: async (request) => {
      const headers: Record<string, string> = { ...(request.headers ?? {}) }
      const authorization = headers.authorization
      delete headers.authorization
      const answer = await http.send({
        method: request.method,
        url: request.url,
        headers,
        ...(authorization ? { token: authorization.replace(/^Bearer\s+/i, '') } : {}),
        ...(request.body === undefined ? {} : { body: request.body }),
      })
      return { status: answer.status, headers: answer.headers, body: answer.body }
    },
  }
}
