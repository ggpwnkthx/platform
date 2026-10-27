import { createRoute } from 'honox/factory'
import { VERSION } from '../../runtime/version'

/** The process is alive. */
export default createRoute((c) =>
  c.json({ status: 'ok', service: 'console', version: VERSION }, 200, {
    'cache-control': 'no-store',
  })
)
