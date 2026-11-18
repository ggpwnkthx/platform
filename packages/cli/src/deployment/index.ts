/** The deploy command: the local stack and Kubernetes. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DEPLOY_HELP } from './help.ts'
import { local } from './local.ts'
import { kubernetes } from './kubernetes.ts'
import { type DeployRuntime, ROOT, runtime } from './runtime.ts'

export { DEPLOY_HELP } from './help.ts'
export { localDatabase } from './local.ts'
export { renderKubernetes } from './kubernetes.ts'
export type { DeployRuntime } from './runtime.ts'

export async function deploy(args: string[], r: DeployRuntime = runtime): Promise<number> {
  const [target, action, ...rest] = args
  if (!target || ['help', '--help', '-h'].includes(target)) {
    r.print(DEPLOY_HELP)
    return 0
  }
  if (!action) throw new Error('A deployment action is required. Run deploy help.')
  if (!existsSync(join(ROOT, 'deploy')))
    throw new Error('Deploy must run from a complete source checkout')
  if (target === 'local') return local(action, rest, r)
  if (target === 'k8s' || target === 'kubernetes') return kubernetes(action, rest, r)
  throw new Error(`Unknown deployment target: ${target}. Supported targets: local, k8s.`)
}
