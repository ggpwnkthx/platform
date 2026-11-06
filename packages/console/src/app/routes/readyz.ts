import { createRoute } from 'honox/factory'

/**
 * The console is ready when Access answers its discovery
 * document: a console that cannot sign anybody in is not ready to be
 * reached.
 *
 * The answer has to fit in the budget of the probe that asks for it.
 * The probe of the platform gives the console a few seconds and treats
 * a console that does not answer in them as a console that is not
 * there: the console answers "not ready" inside the budget of a probe
 * instead of waiting for a call that may never end.
 */
export default createRoute(async (c) => {
  const services = c.get('services')
  try {
    await services.provider.discovery(services.config.probeTimeoutMs)
    return c.json({ status: 'ready' }, 200, { 'cache-control': 'no-store' })
  } catch {
    return c.json({ status: 'not-ready' }, 503, { 'cache-control': 'no-store' })
  }
})
