import type { DeployRuntime } from './runtime.ts'
import { stack } from './local/stack.ts'

/** The local stack: Docker Compose or Podman Compose, with PostgreSQL, Dex and the relay. */
export async function local(action: string, args: string[], r: DeployRuntime): Promise<number> {
  // The commands that take a while are one run from their first line to their last. When
  // one fails, the run is left open: whoever reports the error closes it under it.
  const whole = ['up', 'init', 'build'].includes(action)
  if (whole) r.begin(`platform deploy local ${action}`)
  const last: { word?: string } = {}
  const code = await stack(action, args, r, last)
  if (whole) r.done(code ? undefined : last.word)
  return code
}

export { localDatabase } from './local/settings.ts'
