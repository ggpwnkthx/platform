import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { addresses, type Answers, ENV_FILE, flags, ROOT, settle, sh } from './settings.ts'

/**
 * The local stack: PostgreSQL 18 with its token validator, Dex, the relay, an edge in front
 * of them and, when the deployment has a folder of its own, its site — on Docker Compose or
 * Podman Compose, from deploy/compose/compose.yaml. Everything it installs is a SQL file, run
 * by psql beside the server, through PostgreSQL's own socket: no login has a password.
 */
const ACTIONS = ['up', 'init', 'build', 'validate', 'status', 'logs', 'down', 'psql']
const COMPOSE = join(ROOT, 'deploy/compose/compose.yaml')
const engines: Record<string, string[][]> = {
  auto: [['docker', 'compose'], ['podman', 'compose'], ['docker-compose'], ['podman-compose']],
  docker: [['docker', 'compose'], ['docker-compose']],
  podman: [['podman', 'compose'], ['podman-compose']],
}
const step = async (doing: string, code: Promise<number>) => {
  console.log(`· ${doing}`)
  if (await code)
    throw new Error(`${doing} failed. \`deploy local logs\` says what the stack said.`)
}
async function until(what: string, seconds: number, check: () => Promise<boolean>) {
  for (const deadline = Date.now() + seconds * 1000; Date.now() < deadline; await Bun.sleep(1000))
    if (await check().catch(() => false)) return
  throw new Error(
    `${what} did not answer within ${seconds}s. \`deploy local logs\` says what it said.`
  )
}
/** The SQL files a site folder applies, after the platform's own migration. */
export function applied(folder: string | null): string[] {
  if (!folder || !existsSync(join(folder, 'platform.json'))) return []
  const said = JSON.parse(readFileSync(join(folder, 'platform.json'), 'utf8')) as {
    apply?: string[]
  }
  return (said.apply ?? []).map((file) => join(folder, file))
}

export async function local(action: string, args: string[]): Promise<number> {
  if (!ACTIONS.includes(action))
    throw new Error(`Unknown local action: ${action}. One of: ${ACTIONS.join(', ')}.`)
  const { values, rest } = flags(args, ['engine', 'timeout', 'domain'])
  if (rest.length && !['logs', 'down', 'psql'].includes(action))
    throw new Error(`Unexpected argument: ${rest.join(' ')}`)
  const a = settle('local', values.domain ? { PLATFORM_DOMAIN: values.domain } : {})
  const at = addresses('local', a)
  const timeout = Number(values.timeout ?? 120)
  const candidates = engines[values.engine ?? 'auto']
  if (!candidates) throw new Error('--engine must be auto, docker or podman')
  let tool: string[] | undefined
  for (const candidate of candidates)
    if (
      !tool &&
      Bun.which(candidate[0]!) &&
      (await sh([...candidate, 'version'], { quiet: true })) === 0
    )
      tool = candidate
  if (!tool)
    throw new Error(
      'No working Compose command found. Install Docker Compose or Podman Compose, or select --engine.'
    )
  // Dex keeps one account with a password, the break-glass administrator: a second, weaker
  // sign-in system, so a deployment on a name of its own must say DEX_LOCAL_ADMIN=1 to have it.
  const asked = process.env.DEX_LOCAL_ADMIN ?? a.DEX_LOCAL_ADMIN
  const passwordDb = asked === '1' || (asked === undefined && a.PLATFORM_DOMAIN === 'localhost')
  const env: Answers = {
    ...(process.env as Answers),
    ...a,
    PLATFORM_PUBLIC_ORIGIN: new URL(at.site).origin,
    DEX_LOCAL_ADMIN: passwordDb ? '1' : '',
    // Only its hash leaves the settings file.
    DEX_ADMIN_HASH: passwordDb
      ? await Bun.password.hash(a.PLATFORM_ADMIN_PASSWORD!, { algorithm: 'bcrypt', cost: 12 })
      : '',
    PLATFORM_SITE_DIST: at.siteFolder ? join(at.siteFolder, '.dist') : join(ROOT, 'deploy/compose'),
  }
  const run = (more: string[], options: { quiet?: boolean; input?: string } = {}) =>
    sh([...tool, '-p', 'platform', '-f', COMPOSE, ...more], { env, ...options })
  /** psql beside PostgreSQL, through its own socket, as the server's superuser: the one way in without a token. */
  const psql = (more: string[], options: { quiet?: boolean; input?: string } = {}) =>
    run(
      [
        'exec',
        '-T',
        '-e',
        `PGOPTIONS=-c deployment.admin=${a.PLATFORM_ADMIN}`,
        'postgres',
        'psql',
        '-U',
        'postgres',
        '-d',
        'platform',
        '-v',
        'ON_ERROR_STOP=1',
        '--no-psqlrc',
        ...more,
      ],
      options
    )
  const files = (paths: string[]) => paths.map((path) => readFileSync(path, 'utf8')).join('\n')

  if (action === 'validate') return run(['config', '--quiet'])
  if (action === 'status') return run(['ps'])
  if (action === 'logs') return run(['logs', ...rest])
  if (action === 'down') return run(['down', ...rest])
  if (action === 'psql')
    return run(['exec', 'postgres', 'psql', '-U', 'postgres', '-d', 'platform', ...rest])

  await step('Building the images', run(['build', 'postgres', 'relay', 'site']))
  if (action === 'build') return 0
  await step('Starting PostgreSQL, Dex and the edge', run(['up', '-d', 'postgres', 'dex', 'edge']))
  await until(
    'PostgreSQL',
    timeout,
    async () =>
      (await run(['exec', '-T', 'postgres', 'pg_isready', '-U', 'postgres', '-d', 'platform'], {
        quiet: true,
      })) === 0
  )
  await until(
    'Dex',
    timeout,
    async () => (await fetch(`${at.issuer}/.well-known/openid-configuration`)).ok
  )
  // A database that is installed is left as it is: its SQL files were written to run once.
  const installed =
    (await psql(['-tAc', "SELECT 1/(to_regclass('platform.installation') IS NOT NULL)::int"], {
      quiet: true,
    })) === 0
  if (installed) console.log('· The platform is installed already: nothing is applied again')
  else {
    const site = applied(at.siteFolder)
    const sql = [
      join(ROOT, 'migrations/0001_platform.sql'),
      ...(site.length ? site : [join(ROOT, 'deploy/sql/administrator.sql')]),
      join(ROOT, 'deploy/sql/harden.sql'),
      join(ROOT, 'deploy/sql/guard.sql'),
    ]
    await step(
      `Installing the platform${site.length ? `, what ${a.PLATFORM_SITE} applies,` : ''} and the guard, in one transaction`,
      psql(['-1', '-f', '-'], { input: files(sql) })
    )
  }
  if (action === 'init') return 0
  await step('Starting the relay', run(['up', '-d', 'relay']))
  await until(
    'The relay',
    timeout,
    async () => (await fetch(`${at.relay.replace(/^ws/, 'http')}/health`)).ok
  )
  if (at.siteFolder) {
    const build = { ...env, PLATFORM_ISSUER: at.issuer, PLATFORM_RELAY_URL: at.relay }
    await step(
      'Building the site',
      sh(['bun', '--bun', 'x', 'vite', 'build'], { env: build, cwd: at.siteFolder })
    )
    await step('Serving the site', run(['up', '-d', 'site']))
  }
  const unknown = (
    await Promise.all(
      [at.issuer, at.relay, at.site]
        .map((address) => new URL(address).hostname)
        .map((host) =>
          Bun.dns.lookup(host).then(
            () => null,
            () => host
          )
        )
    )
  ).filter(Boolean)
  console.log(
    [
      '',
      'The stack is running.',
      ...(at.siteFolder
        ? [`  Site        ${at.site}`]
        : [`  No site is deployed: name its folder as PLATFORM_SITE in ${ENV_FILE}.`]),
      `  Issuer      ${at.issuer}`,
      `  Relay       ${at.relay}`,
      `  PostgreSQL  ${at.database}:${a.POSTGRES_PORT}`,
      '',
      passwordDb
        ? `Sign in as ${a.PLATFORM_ADMIN}, the break-glass administrator; the password is PLATFORM_ADMIN_PASSWORD in ${ENV_FILE}.`
        : `Sign in as ${a.PLATFORM_ADMIN} through a connector: add an identity provider in deploy/dex/config.yaml.tmpl.`,
      'PostgreSQL has no password: psql signs in through the issuer, and `deploy local psql` opens one beside the server.',
      ...(unknown.length
        ? [
            `These names do not resolve on this machine; add them to your hosts file:\n127.0.0.1 ${unknown.join(' ')}`,
          ]
        : []),
    ].join('\n')
  )
  return 0
}
