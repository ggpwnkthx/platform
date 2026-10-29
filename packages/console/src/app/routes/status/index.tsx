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
import { PageHead, SectionHead } from '../../components/page'
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
        eyebrow="Health"
        title="Status"
        lede={
          board.detail
            ? 'Probes of the gateway, Access, Data and the console, refreshed every ten seconds.'
            : 'Whether each service is up. Versions, latencies and probe answers are shown to operators who hold console.status.'
        }
      />
      <StatusBoard initial={board} endpoint="/status/probes" intervalMs={10_000} />
      <section class="stack">
        <SectionHead
          title="Request map"
          lede="Which services talk to each other when a record is read, someone signs in, or an operator changes a grant. Pick a request to highlight its exchanges in order."
        />
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
