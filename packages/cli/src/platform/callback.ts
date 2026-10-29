/**
 * The server of the callback of a login.
 *
 * The provider sends the caller back to an address of the machine, and
 * the address has to answer before the code expires. The server runs on
 * the loopback address, it answers once, and it stops: a server that
 * waits for a second callback is a server an attacker can use.
 */

import type { CallbackPort, CallbackServer } from '../domains/contracts'
import { CliFailure } from '../domains/failure'

/** The server of the callback of the login. */
export const loopbackCallback: CallbackPort = {
  /**
   * Starts a server that answers on the path of the callback.
   *
   * @param options the host, the port and the path of the callback.
   */
  async start(options: {
    readonly host: string
    readonly port: number
    readonly path: string
  }): Promise<CallbackServer> {
    let settle: ((answer: { code: string; state: string }) => void) | undefined
    let fail: ((error: Error) => void) | undefined
    const answered = new Promise<{ code: string; state: string }>((resolve, reject) => {
      settle = resolve
      fail = reject
    })
    const server = Bun.serve({
      hostname: options.host,
      port: options.port,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname !== options.path) {
          return new Response('not found', { status: 404 })
        }
        const error = url.searchParams.get('error')
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state') ?? ''
        if (error) {
          fail?.(new CliFailure(`the provider refused the login: ${error}`, 3, 'login_refused'))
          return new Response('the login was refused', { status: 400 })
        }
        if (!code) {
          fail?.(new CliFailure('the provider answered without a code', 8, 'no_code'))
          return new Response('the answer holds no code', { status: 400 })
        }
        settle?.({ code, state })
        return new Response('the login is done, this page can be closed.', {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      },
    })
    const redirectUri = `http://${options.host}:${options.port}${options.path}`
    return {
      redirectUri,
      async wait(): Promise<{ code: string; state: string }> {
        try {
          return await answered
        } finally {
          server.stop(true)
        }
      },
    }
  },
}
