import { lookup } from 'node:dns/promises'
import { join } from 'node:path'
import * as say from '@clack/prompts'
import { ROOT, siteFiles } from '../site.ts'
import { buildUi } from '../site.ts'
import { addresses, ensureSettings, ENV_FILE, readEnv } from './settings.ts'
import { flags, sh, step, until } from './shell.ts'

const LOCAL = ['up', 'init', 'admin', 'ui', 'validate', 'build', 'status', 'logs', 'down']
const COMPOSE_FILE = join(ROOT, 'deploy/compose/compose.yaml')

/** Docker Compose or Podman Compose, using deploy/compose/compose.yaml. */
export async function local(action: string, args: string[]): Promise<number> {
  if (!LOCAL.includes(action))
    throw new Error(`Unknown local action: ${action}. One of: ${LOCAL.join(', ')}.`)
  const passes = ['logs', 'down', 'admin'].includes(action)
  const { values, rest } = flags(args, ['engine', 'timeout', 'domain'])
  if (rest.length && !passes) throw new Error(`Unexpected argument: ${rest.join(' ')}`)
  const a = await ensureSettings('local', values.domain ? { PLATFORM_DOMAIN: values.domain } : {})
  const at = addresses('local', a)
  const timeout = Number(values.timeout ?? 120)
  const siteEnv = {
    ...process.env,
    PLATFORM_ISSUER: at.issuer,
    PLATFORM_RELAY_URL: at.relay,
    PLATFORM_PUBLIC_URL: at.site,
  }
  const buildSite = () => {
    Object.assign(process.env, siteEnv)
    return buildUi({ dir: at.siteFolder ?? undefined, production: true })
  }
  if (action === 'ui') {
    const out = await buildSite()
    console.log(
      `The site is built in ${out}: publish that folder. Its config.json points the pages at ${at.relay} and ${at.issuer}.`
    )
    return 0
  }
  const engine = values.engine ?? 'auto'
  const candidates = {
    auto: [['docker', 'compose'], ['podman', 'compose'], ['docker-compose'], ['podman-compose']],
    docker: [['docker', 'compose'], ['docker-compose']],
    podman: [['podman', 'compose'], ['podman-compose']],
  }[engine]
  if (!candidates) throw new Error('--engine must be auto, docker or podman')
  let tool: string[] | undefined
  for (const candidate of candidates)
    if (Bun.which(candidate[0]!) && (await sh([...candidate, 'version'], { quiet: true })) === 0)
      tool ??= candidate
  if (!tool)
    throw new Error(
      'No working Compose command found. Install Docker Compose or Podman Compose, or select --engine.'
    )
  // Dex keeps one account with a password, the break-glass administrator. It is a second,
  // weaker sign-in system, so it belongs to a development stack: a deployment on a name of
  // its own must say DEX_LOCAL_ADMIN=1 to have one at all.
  const asked = process.env.DEX_LOCAL_ADMIN ?? readEnv().DEX_LOCAL_ADMIN
  const passwordDb = asked === '1' || (asked === undefined && a.PLATFORM_DOMAIN === 'localhost')
  const env = {
    ...process.env,
    ...a,
    PLATFORM_PUBLIC_ORIGIN: new URL(at.site).origin,
    DEX_LOCAL_ADMIN: passwordDb ? '1' : '',
    // Only its hash leaves this file.
    DEX_ADMIN_HASH: passwordDb
      ? await Bun.password.hash(a.PLATFORM_ADMIN_PASSWORD!, {
          algorithm: 'bcrypt',
          cost: 12,
        })
      : '',
    PLATFORM_SITE_FOLDER: at.siteFolder ?? join(ROOT, 'examples'),
    PLATFORM_SITE_DIST: at.siteFolder
      ? join(at.siteFolder, '.dist')
      : join(ROOT, 'packages/ui/dist'),
  }
  const compose = (more: string[], profile: string[] = []) => [
    ...tool,
    ...profile,
    '-p',
    'platform',
    '-f',
    COMPOSE_FILE,
    ...more,
  ]
  const run = (more: string[], quiet = false) => sh(compose(more), { env, quiet })
  /** An operator command beside PostgreSQL, through its own socket, as the server's superuser. */
  const beside = (command: string[]) =>
    sh(
      compose(['run', '--rm', '--no-deps', '-T', 'migrate', ...command], ['--profile', 'install']),
      { env }
    )
  if (action === 'validate') return run(['config', '--quiet'])
  if (action === 'status') return run(['ps'])
  if (action === 'logs') return run(['logs', ...rest])
  if (action === 'down') return run(['down', ...rest])
  if (action === 'admin') {
    if (!rest.length)
      throw new Error('admin needs a command, such as doctor, harden k8s or unlock ROLE')
    return beside(rest)
  }
  say.intro(`platform deploy local ${action}`)
  await warnAboutNames([at.issuer, at.relay, at.site])
  await step(
    'Building the images',
    sh(compose(['build', 'postgres', 'relay', 'migrate'], ['--profile', 'install']), { env })
  )
  if (action === 'build') return 0
  await step('Starting PostgreSQL, Dex and the edge', run(['up', '-d', 'postgres', 'dex', 'edge']))
  await until(
    'PostgreSQL',
    timeout,
    async () =>
      (await run(
        ['exec', '-T', 'postgres', 'pg_isready', '-U', 'postgres', '-d', 'platform'],
        true
      )) === 0
  )
  await until(
    'Dex',
    timeout,
    async () => (await fetch(`${at.issuer}/.well-known/openid-configuration`)).ok
  )
  await step('Installing the platform', beside(['migrate']))
  // What the deployment's site applies; a deployment with no site is given its administrator's role alone.
  const applies = at.siteFolder && siteFiles(at.siteFolder)?.apply
  await step(
    applies
      ? `Installing what ${a.PLATFORM_SITE} applies`
      : 'Creating the role of the administrator',
    beside(['apply', 'k8s', applies ? '--dir=/app/site' : '--administrator'])
  )
  // The deployment is hardened as it is installed: the role catalogs are hidden from ordinary
  // connections, and the guard that keeps a collection in row security is put in place.
  await step(
    'Hiding the role catalogs and guarding row security',
    beside(['harden', 'k8s', '--events'])
  )
  if (action === 'init') return 0
  await step('Starting the relay', run(['up', '-d', 'relay']))
  await until(
    'The relay',
    timeout,
    async () =>
      (await fetch(`${at.issuer.replace(a.PLATFORM_IDP_HOST!, a.PLATFORM_API_HOST!)}/health`)).ok
  )
  if (!a.PLATFORM_PUBLIC_URL) {
    say.log.step('Building the site')
    await buildSite()
    await step('Serving the site', run(['up', '-d', 'site']))
  }
  say.note(
    [
      ...(a.PLATFORM_PUBLIC_URL ? [] : [`Site        ${at.site}`]),
      `Issuer      ${at.issuer}`,
      `Relay       ${at.relay}`,
      `PostgreSQL  ${at.database}:${a.POSTGRES_PORT}`,
      '',
      passwordDb
        ? `Sign in as ${a.PLATFORM_ADMIN}, the break-glass administrator; the password is PLATFORM_ADMIN_PASSWORD in ${ENV_FILE}.`
        : `Sign in as ${a.PLATFORM_ADMIN}, the administrator, through a connector: add an identity provider in deploy/dex/config.yaml.tmpl.`,
      'Everybody else signs in through a connector too.',
      'PostgreSQL has no password: sign in with a token (`bun run cli token`), or administer the stack with `bun run cli deploy local admin <command>`.',
    ].join('\n'),
    'The stack is running'
  )
  say.outro(a.PLATFORM_PUBLIC_URL ? 'The stack is running' : `The site is at ${at.site}`)
  return 0
}

/** The names of the deployment that do not resolve on this machine, said plainly. */
async function warnAboutNames(addresses: string[]) {
  const names = addresses.map((address) => new URL(address).hostname)
  const unknown = (
    await Promise.all(
      names.map((host) =>
        lookup(host).then(
          () => null,
          () => host
        )
      )
    )
  ).filter(Boolean)
  if (unknown.length)
    say.log.warn(
      `These names do not resolve on this machine; add them to your hosts file:\n127.0.0.1 ${unknown.join(' ')}`
    )
}
