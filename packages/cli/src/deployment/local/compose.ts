import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type DeployRuntime, type RunOptions, ROOT } from '../runtime.ts'

/**
 * The command the stack's own commands are run with: the Compose tool that was found, the
 * file of the stack, and the project it belongs to.
 */
export function composeCommand(r: DeployRuntime, tool: string[]): string[] {
  return [
    ...tool,
    // Not --project-directory: podman-compose has no such option, and the file's relative paths
    // are written against its own directory. Only the .env lookup has to be pointed at the root.
    ...(existsSync(r.envFile) ? ['--env-file', r.envFile] : []),
    '-p',
    'platform',
    '-f',
    join(ROOT, 'deploy/compose/compose.yaml'),
  ]
}

/**
 * What the services said as they started, for when one does not become ready: the reason is
 * usually there, and often in the one beside the one that was waited for.
 */
export function tailOf(run: (a: string[], extra?: RunOptions) => Promise<number>) {
  return (...services: string[]) =>
    async () => {
      for (const service of services)
        await run(['logs', '--tail', '40', service], { report: `What ${service} said last` })
    }
}

/**
 * The actions the stack answers with one command of its own: what the Compose file holds, how
 * it runs, what it says, and the operator's own tools beside PostgreSQL. Nothing else is
 * started when one of these is asked for.
 */
export async function quickAction(
  action: string,
  args: string[],
  run: (a: string[], extra?: RunOptions) => Promise<number>,
  beside: (command: string[], task?: RunOptions['task']) => Promise<number>
): Promise<number | undefined> {
  if (action === 'validate') return run(['config'], { quiet: true })
  if (action === 'status') return run(['ps'])
  if (action === 'logs') return run(['logs', ...args])
  if (action === 'down') return run(['down', ...args])
  if (action === 'admin') {
    if (!args.length)
      throw new Error('admin needs a command, such as doctor, harden k8s or unlock ROLE')
    return beside(args)
  }
  return undefined
}

export async function compose(engine: string, r: DeployRuntime): Promise<string[]> {
  if (!['auto', 'docker', 'podman'].includes(engine))
    throw new Error('--engine must be auto, docker or podman')
  const candidates =
    engine === 'docker'
      ? [['docker', 'compose'], ['docker-compose']]
      : engine === 'podman'
        ? [['podman', 'compose'], ['podman-compose']]
        : [['docker', 'compose'], ['podman', 'compose'], ['docker-compose'], ['podman-compose']]
  for (const cmd of candidates)
    if (r.which(cmd[0]!) && (await r.run([...cmd, 'version'], { quiet: true })) === 0) return cmd
  throw new Error(
    'No working Compose command found. Install Docker Compose or Podman Compose, or select --engine.'
  )
}
export async function wait(
  check: () => Promise<boolean>,
  timeout: number,
  r: DeployRuntime,
  label: string,
  /** Shows what the service said last: the reason it is not ready is usually there. */
  logs?: () => Promise<unknown>
) {
  // Bounded attempts make the timeout independent of an injected/test clock.
  const deadline = Date.now() + timeout * 1000
  const waiting = r.waiting(`Waiting for ${label.replace(/^The /, 'the ')}`)
  for (let i = 0; i < timeout && Date.now() < deadline; i++) {
    if (await check()) {
      waiting.done(`${label} is ready`)
      return
    }
    await r.sleep(1000)
  }
  waiting.fail(`No answer from ${label.replace(/^The /, 'the ')} after ${timeout}s`)
  await logs?.()
  throw new Error(
    `${label} did not become ready. What it said last is above; \`deploy local logs\` has the rest.`
  )
}
