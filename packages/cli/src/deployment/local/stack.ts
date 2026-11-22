import {
  type DeployRuntime,
  type RunOptions,
  LOCAL_OPTIONS,
  PASSTHROUGH_ACTIONS,
  seconds,
} from '../runtime.ts'
import { options } from '../../options.ts'
import { compose, composeCommand, quickAction, tailOf } from './compose.ts'
import { prepareStack } from './prepare.ts'
import { reportStack } from './report.ts'
import { buildImages, installPlatform, serveSite, startRelay, startServices } from './services.ts'
import { stackSettings } from './settings.ts'
import { stackEnv } from './env.ts'

export async function stack(
  action: string,
  args: string[],
  r: DeployRuntime,
  /** The last word of the run, when there is one: where to go next. */
  last: { word?: string }
): Promise<number> {
  // The logs of the stack, and the things an operator asks of it, are another program's
  // arguments: what is left of them is given on as it was written.
  const onward = PASSTHROUGH_ACTIONS.includes(action)
  const { values, rest } = options(args, LOCAL_OPTIONS, {
    unknown: onward ? 'keep' : 'refuse',
    positionals: onward ? 'keep' : 'refuse',
  })
  const engine = values.engine ?? 'auto'
  const timeout = seconds(values.timeout)
  const domainOption = values.domain
  const prepared = await prepareStack(action, r, domainOption)
  if (prepared.built !== undefined) return prepared.built
  const computed = prepared.computed
  const s = stackSettings(r, domainOption)
  // The names have to answer on this machine: the browser opens the issuer and the relay,
  // the operator's own tools reach the database.
  await r.hosts([s.idp, s.api, s.db, ...(s.site ? [s.app] : [])])
  const tool = await compose(engine, r)
  const base = tool.length
  const cmd = composeCommand(r, tool)
  const env = await stackEnv(r, computed, s, ['up', 'init', 'build', 'validate'].includes(action))
  const run = (a: string[], extra: RunOptions = {}) => r.run([...cmd, ...a], { env, ...extra })
  /**
   * The operator's tools, run beside PostgreSQL and connected through its own socket: the
   * way the stack is installed, and the way it is administered by whoever runs it. Nothing is
   * handed over, because there is nothing to hand: the socket is the credential.
   */
  const beside = (command: string[], task?: RunOptions['task']) =>
    r.run(
      [
        ...cmd.slice(0, base),
        '--profile',
        'install',
        ...cmd.slice(base),
        'run',
        '--rm',
        '--no-deps',
        '-T',
        'migrate',
        ...command,
      ],
      { env, task }
    )
  const quick = await quickAction(action, rest, run, beside)
  if (quick !== undefined) return quick
  const built = await buildImages(r, cmd, base, env)
  if (built || action === 'build') return built
  const tail = tailOf(run)
  const started = await startServices(run, r, s, timeout, tail)
  if (started !== undefined) return started
  const installed = await installPlatform(beside, s)
  if (installed || action === 'init') return installed
  const served = await startRelay(run, r, s, timeout, tail)
  if (served !== undefined) return served
  const issuer = `http://${s.idp}:${s.edgePort}`
  const relayUrl = `ws://${s.api}:${s.edgePort}`
  const siteUrl = `http://${s.app}:${s.edgePort}`
  if (s.site) {
    const published = await serveSite(run, r, computed, s, siteUrl, timeout, tail)
    if (published !== undefined) return published
  }
  reportStack(r, s, last, issuer, relayUrl, siteUrl)
  return 0
}
