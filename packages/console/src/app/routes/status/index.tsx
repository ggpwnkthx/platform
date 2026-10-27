/**
 * The status of the platform: the state of its services, and the map of
 * the requests that cross them.
 *
 * Anybody reads the state of the services; the operators who hold
 * `console.status` read their versions, their latencies and what their
 * probes answered.
 */

import { createRoute } from 'honox/factory'
import { GEOMETRY, MAP_HOPS, MAP_REQUESTS, MAP_STATIONS } from '../../../domains/map'
import { PageHead } from '../../components/page'
import PlatformMap from '../../islands/platform-map'
import StatusBoard from '../../islands/status-board'
import { boardOf } from '../../middleware/board'

export default createRoute(async (c) => {
  const board = await boardOf(c)
  const requested = c.req.query('request') ?? 'record'
  const initialRequest = MAP_REQUESTS.some((request) => request.id === requested) ? requested : ''
  return c.render(
    <>
      <PageHead
        title="The status of the platform"
        lede={
          board.detail
            ? 'The probes of the gateway, the access service and the data service, read again every ten seconds.'
            : 'The state of the services of the platform. Their detail is for the operators who hold console.status.'
        }
      />
      <StatusBoard initial={board} endpoint="/status/probes" intervalMs={10_000} />
      <section class="stack">
        <header class="page-head">
          <h2>The map of the platform</h2>
          <p class="lede">
            Who talks to whom when a record is read, when somebody signs in and when an operator
            changes a grant. Pick a request to light the exchanges it crosses, in order.
          </p>
        </header>
        <PlatformMap
          stations={MAP_STATIONS}
          hops={MAP_HOPS}
          requests={MAP_REQUESTS}
          geometry={GEOMETRY}
          initialRequest={initialRequest}
        />
      </section>
    </>,
    { title: 'Status', section: 'status' }
  )
})
