/**
 * The probes of the services, as json: the board of the status reads
 * them again every few seconds.
 */

import { createRoute } from 'honox/factory'
import { boardOf } from '../../middleware/board'

export default createRoute(async (c) =>
  c.json(await boardOf(c), 200, { 'cache-control': 'no-store' })
)
