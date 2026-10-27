/**
 * The page of a request that failed.
 *
 * A refusal of a service is the refusal the reader reads: its status, its
 * code, its message and the identifier of its request, as the service
 * answered them. A failure of the console itself says nothing of its
 * cause: the cause is in the log.
 */

import type { ErrorHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { PageHead, Refusal, refusalOf } from '../components/page'
import { hereOf, loginUrl } from '../middleware/session'
import '../context'

const handler: ErrorHandler = (error, c) => {
  const refusal = refusalOf(error)
  const services = c.get('services')
  if (refusal.status >= 500 && refusal.code === null && refusal.requestId === null) {
    services?.log.error('the request failed', {
      requestId: c.get('requestId'),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
  }
  // A caller that the gateway does not recognise any more holds a token
  // that expired: the login renews it.
  if (refusal.status === 401 && c.req.method === 'GET' && c.get('session')) {
    return c.redirect(loginUrl(hereOf(c)))
  }
  const status = (
    refusal.status >= 400 && refusal.status <= 599 ? refusal.status : 500
  ) as ContentfulStatusCode
  c.status(status)
  return c.render(
    <section class="refusal">
      <PageHead title={refusal.title} />
      <Refusal refusal={refusal} />
      <p class="row">
        <a class="button quiet" href="/">
          The overview
        </a>
      </p>
    </section>,
    { title: refusal.title }
  )
}

export default handler
