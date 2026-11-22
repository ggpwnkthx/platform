import type { DeployRuntime, RunOptions } from '../runtime.ts'
import { type tailOf, wait } from './compose.ts'
import type { StackSettings } from './settings.ts'
import { buildFiles } from './site.ts'

/**
 * PostgreSQL, Dex and the edge are started together: Dex and the edge share PostgreSQL's
 * network namespace, so see the Compose file. The edge is started with them: it is what
 * answers on the issuer's name, and Dex is asked through it. Each is then waited for, and
 * what it said last is shown when one of them does not come.
 */
export async function startServices(
  run: (a: string[], extra?: RunOptions) => Promise<number>,
  r: DeployRuntime,
  s: StackSettings,
  timeout: number,
  tail: ReturnType<typeof tailOf>
): Promise<number | undefined> {
  const started = await run(['up', '-d', 'postgres', 'dex', 'edge'], {
    task: {
      doing: 'Starting PostgreSQL, Dex and the edge',
      done: 'PostgreSQL, Dex and the edge are started',
    },
  })
  if (started) return started
  await wait(
    async () =>
      (await run(['exec', '-T', 'postgres', 'pg_isready', '-U', 'postgres', '-d', 'platform'], {
        quiet: true,
      })) === 0,
    timeout,
    r,
    'PostgreSQL',
    tail('postgres')
  )
  // The issuer, on the deployment's own name for Dex: the browser and PostgreSQL both open
  // it, so it is the name both of them answer for. The edge answers it.
  await wait(
    () => r.healthy(`http://${s.idp}:${s.edgePort}/.well-known/openid-configuration`),
    timeout,
    r,
    'Dex',
    tail('dex', 'edge')
  )
  return undefined
}

/**
 * The relay is started last of the services: the pages need the issuer and the relay, and
 * the relay answers on the deployment's own name for it.
 */
export async function startRelay(
  run: (a: string[], extra?: RunOptions) => Promise<number>,
  r: DeployRuntime,
  s: StackSettings,
  timeout: number,
  tail: ReturnType<typeof tailOf>
): Promise<number | undefined> {
  const served = await run(['up', '-d', 'relay'], {
    task: { doing: 'Starting the relay', done: 'The relay is started' },
  })
  if (served) return served
  await wait(
    () => r.healthy(`http://${s.api}:${s.edgePort}/health`),
    timeout,
    r,
    'The relay',
    tail('relay', 'edge')
  )
  return undefined
}

/**
 * The images the stack runs: PostgreSQL, the relay and the installer. The installer's image
 * is built with the rest: its service sits behind the install profile. Each image is built by
 * a command of its own, so that what it says is its own.
 */
export async function buildImages(
  r: DeployRuntime,
  cmd: string[],
  base: number,
  env: Record<string, string | undefined>
): Promise<number> {
  const building = (service: string) => [
    ...cmd.slice(0, base),
    '--profile',
    'install',
    ...cmd.slice(base),
    'build',
    service,
  ]
  return await r.together(
    { doing: 'Building the images', done: 'The images are built' },
    [
      { name: 'PostgreSQL', argv: building('postgres'), done: 'PostgreSQL is built' },
      { name: 'The relay', argv: building('relay'), done: 'The relay is built' },
      { name: 'The installer', argv: building('migrate'), done: 'The installer is built' },
    ],
    { env }
  )
}

/**
 * The platform is installed beside PostgreSQL and is let in by its socket. It installs the
 * platform, then what the deployment's site applies, from its folder: its models.ts, its
 * migration.sql and, the first time, its demo.sql. A deployment whose site applies nothing,
 * or that has no site, is given its administrator and nothing else, so that there is somebody
 * to sign in as. What each of them did is its last line: the version installed, the count of
 * changes.
 */
export async function installPlatform(
  beside: (command: string[], task?: RunOptions['task']) => Promise<number>,
  s: StackSettings
): Promise<number> {
  const lastLine = (fallback: string) => (said: string[]) => said.at(-1) ?? fallback
  return (
    (await beside([], {
      doing: 'Installing the platform',
      done: lastLine('The platform is installed'),
    })) ||
    (await beside(
      // The folder is mounted beside the installer, wherever it is on this machine.
      ['apply', 'k8s', s.folder?.apply ? '--dir=/app/site' : '--administrator'],
      s.folder?.apply
        ? {
            doing: `Installing what ${s.siteName} applies`,
            done: (said) => `What ${s.siteName} applies is installed: ${lastLine('done')(said)}`,
          }
        : {
            doing: 'Creating the role of the administrator',
            done: (said) => `The administrator has its role: ${lastLine('done')(said)}`,
          }
    ))
  )
}

/**
 * The site: built here, as it would be for a CDN, and served by the stack's own static server
 * behind the edge. It is last: the pages need the issuer and the relay.
 */
export async function serveSite(
  run: (a: string[], extra?: RunOptions) => Promise<number>,
  r: DeployRuntime,
  computed: Record<string, string>,
  s: StackSettings,
  siteUrl: string,
  timeout: number,
  tail: ReturnType<typeof tailOf>
): Promise<number | undefined> {
  const files = await buildFiles(r, computed, {
    doing: `Building the ${s.siteName} site`,
    done: `The ${s.siteName} site is built`,
  })
  if (files.code) return files.code
  const published = await run(['up', '-d', 'site'], {
    task: { doing: 'Starting the site', done: 'The site is started' },
  })
  if (published) return published
  await wait(() => r.healthy(`${siteUrl}/`), timeout, r, 'The site', tail('site', 'edge'))
  return undefined
}
