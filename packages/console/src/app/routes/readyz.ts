import { createRoute } from 'honox/factory'

/**
 * The console is ready when the access service answers its discovery
 * document: a console that cannot sign anybody in is not ready to be
 * reached.
 */
export default createRoute(async (c) => {
  try {
    await c.get('services').provider.discovery()
    return c.json({ status: 'ready' }, 200, { 'cache-control': 'no-store' })
  } catch {
    return c.json({ status: 'not-ready' }, 503, { 'cache-control': 'no-store' })
  }
})
