/** The local stack: Docker Compose or Podman Compose, with PostgreSQL, Dex and the relay. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DeployRuntime,
  type RunOptions,
  generate,
  noExtra,
  option,
  ROOT,
  runtime,
  saved,
  seconds,
} from './runtime.ts'
import { computedValues, ensureConfig, settingValue } from './config.ts'

/**
 * The one account the local stack's Dex keeps with a password: the break-glass
 * administrator, the person who installs the database and gets in when nothing else does.
 * Everybody else signs in through a connector, an identity provider that vouches for the
 * addresses it returns.
 */
const LOCAL_ADMIN = {
  DEX_ADMIN_HASH: 'PLATFORM_ADMIN_PASSWORD',
}
/** A setting of the deployment: from the environment, or from the saved file. */
function settingOf(r: DeployRuntime, name: string, fallback: string): string {
  return settingValue(r, name) ?? fallback
}
/**
 * The site's address: the one the operator gave, or the one the example is deployed on.
 * It is worked out from the pieces the configuration holds.
 */
function siteAddress(r: DeployRuntime, computed: Record<string, string>): string {
  return (
    settingValue(r, 'PLATFORM_PUBLIC_URL') ??
    settingValue(r, 'PUBLIC_URL') ??
    computed.PLATFORM_EXAMPLE_URL ??
    'http://localhost:5173'
  )
}
/** Where the local stack publishes PostgreSQL, for commands that sign in to it with a token. */
export function localDatabase(r: DeployRuntime = runtime) {
  const domain = settingOf(r, 'PLATFORM_DOMAIN', 'localhost')
  return {
    host: `${settingOf(r, 'PLATFORM_DB_HOST', 'db')}.${domain}`,
    port: settingOf(r, 'POSTGRES_PORT', '5432'),
    name: 'platform',
  }
}
async function compose(engine: string, r: DeployRuntime): Promise<string[]> {
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
async function wait(
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
async function stack(
  action: string,
  args: string[],
  r: DeployRuntime,
  /** The last word of the run, when there is one: where to go next. */
  last: { word?: string }
): Promise<number> {
  const engine = option(args, 'engine') ?? 'auto'
  const timeout = seconds(option(args, 'timeout'))
  const domainOption = option(args, 'domain')
  if (
    !['up', 'init', 'ui', 'validate', 'build', 'status', 'logs', 'down', 'admin'].includes(action)
  )
    throw new Error(`Unknown local action: ${action}`)
  if (!['logs', 'down', 'admin'].includes(action)) noExtra(args)
  // The settings of the stack live in one file: when there is none, the first run asks for
  // what it does not know and writes it down, with the secrets it generates in it.
  if (!['status', 'logs', 'down', 'admin'].includes(action))
    await ensureConfig(
      'local',
      {
        PLATFORM_DOMAIN: domainOption ?? r.env.PLATFORM_DOMAIN,
        EDGE_PORT: r.env.EDGE_PORT,
        EDGE_TLS_PORT: r.env.EDGE_TLS_PORT,
        PLATFORM_IDP_HOST: r.env.PLATFORM_IDP_HOST,
        PLATFORM_API_HOST: r.env.PLATFORM_API_HOST,
        PLATFORM_DB_HOST: r.env.PLATFORM_DB_HOST,
        PLATFORM_PUBLIC_URL: r.env.PLATFORM_PUBLIC_URL,
        POSTGRES_PORT: r.env.POSTGRES_PORT,
        DEX_PORT: r.env.DEX_PORT,
        RELAY_PORT: r.env.RELAY_PORT,
        PLATFORM_ADMIN_PASSWORD: r.env.PLATFORM_ADMIN_PASSWORD,
      },
      r
    )
  // The addresses the deployment is named by, worked out from the pieces it is made of.
  const computed = computedValues('local', r)
  // The interface is a static site: building it needs no container, only the toolchain.
  if (action === 'ui') return buildInterface(r, computed)
  const setting = (name: string, fallback: string) => {
    const value = settingOf(r, name, fallback)
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
      throw new Error(`Invalid ${name}`)
    return value
  }
  const text = (name: string, fallback: string) => settingOf(r, name, fallback)
  const dexPort = setting('DEX_PORT', '5556')
  const relayPort = setting('RELAY_PORT', '8081')
  const postgresPort = setting('POSTGRES_PORT', '5432')
  // The names of the deployment: each service answers on its own sub-domain of the domain.
  const domain = domainOption ?? text('PLATFORM_DOMAIN', 'localhost')
  const idpHost = text('PLATFORM_IDP_HOST', 'idp')
  const apiHost = text('PLATFORM_API_HOST', 'api')
  const dbHost = text('PLATFORM_DB_HOST', 'db')
  const idp = `${idpHost}.${domain}`
  const api = `${apiHost}.${domain}`
  const db = `${dbHost}.${domain}`
  // The edge answers on a port of this machine's choosing, never on 80 or 443: a rootless
  // container cannot bind those, and the operator's machine is not the deployment's business.
  const edgePort = setting('EDGE_PORT', '8080')
  const edgeTlsPort = setting('EDGE_TLS_PORT', '4433')
  // The names have to answer on this machine: the browser opens the issuer and the relay,
  // the operator's own tools reach the database.
  // The example the deployment chose, if it chose one: its site is served by the stack
  // itself, on a name of its own. A site of the operator's own is not the stack's business.
  const own = settingValue(r, 'PLATFORM_PUBLIC_URL') ?? settingValue(r, 'PUBLIC_URL')
  const example = own ? '' : text('PLATFORM_EXAMPLE', '')
  if (example && !/^[a-z0-9][a-z0-9-]*$/.test(example)) throw new Error('Invalid PLATFORM_EXAMPLE')
  const appHost = text('PLATFORM_APP_HOST', 'app')
  // The one account the stack's Dex keeps, and the role the installer makes for it: the
  // deployment's own administrator, on its own domain unless another is named.
  const admin = text('PLATFORM_ADMIN', `admin@${domain}`)
  if (!/^[^\s"'\\,@]+@[^\s"'\\,@]+$/.test(admin) || admin.length > 63)
    throw new Error('Invalid PLATFORM_ADMIN')
  const app = `${appHost}.${domain}`
  await r.hosts([idp, api, db, ...(example ? [app] : [])])
  const tool = await compose(engine, r)
  const base = tool.length
  const cmd = [
    ...tool,
    // Not --project-directory: podman-compose has no such option, and the file's relative paths
    // are written against its own directory. Only the .env lookup has to be pointed at the root.
    ...(existsSync(r.envFile) ? ['--env-file', r.envFile] : []),
    '-p',
    'platform',
    '-f',
    join(ROOT, 'deploy/compose/compose.yaml'),
  ]
  // PostgreSQL is given no password, and neither is anything else: the only value generated
  // is the break-glass administrator's, which Dex asks for in place of a real sign-in system.
  // It is generated only once the options are valid and a Compose tool is found.
  const prepares = ['up', 'init', 'build', 'validate'].includes(action)
  const env: Record<string, string | undefined> = {
    ...r.env,
    // Podman says which Compose provider it runs, every time it runs one: once is enough.
    PODMAN_COMPOSE_WARNING_LOGS: 'false',
    DEX_PORT: dexPort,
    RELAY_PORT: relayPort,
    // The names the Compose file builds the addresses of the services from.
    PLATFORM_DOMAIN: domain,
    PLATFORM_IDP_HOST: idpHost,
    PLATFORM_API_HOST: apiHost,
    PLATFORM_DB_HOST: dbHost,
    // The ports the edge answers on, on this machine.
    EDGE_PORT: edgePort,
    EDGE_TLS_PORT: edgeTlsPort,
    // The only origin the relay allows: the address the site is served from.
    PLATFORM_PUBLIC_ORIGIN: siteAddress(r, computed),
    // The example's site: the edge routes its name only when there is one, and the files
    // it is served from are the ones built on this machine.
    PLATFORM_EXAMPLE: example,
    // The administrator: the account Dex keeps, and the role the installer makes for it.
    PLATFORM_ADMIN: admin,
    PLATFORM_APP_HOST: appHost,
    PLATFORM_SITE_DIR: join(ROOT, example ? `examples/${example}/.dist` : 'packages/ui/dist'),
  }
  // Dex is given only hashes. The password stays in the saved file for the operator to read.
  if (prepares)
    for (const [hash, name] of Object.entries(LOCAL_ADMIN))
      env[hash] = await r.hash(r.env[name] || saved(r.envFile, name) || generate(name, r))
  const run = (a: string[], extra: RunOptions = {}) => r.run([...cmd, ...a], { env, ...extra })
  if (action === 'validate') return run(['config'], { quiet: true })
  if (action === 'status') return run(['ps'])
  if (action === 'logs') return run(['logs', ...args])
  if (action === 'down') return run(['down', ...args])
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
  if (action === 'admin') {
    if (!args.length)
      throw new Error('admin needs a command, such as doctor, harden k8s or unlock ROLE')
    return beside(args)
  }
  // The installer's image is built with the rest: its service sits behind the install profile.
  // Each image is built by a command of its own, so that what it says is its own.
  const building = (service: string) => [
    ...cmd.slice(0, base),
    '--profile',
    'install',
    ...cmd.slice(base),
    'build',
    service,
  ]
  const built = await r.together(
    { doing: 'Building the images', done: 'The images are built' },
    [
      { name: 'PostgreSQL', argv: building('postgres'), done: 'PostgreSQL is built' },
      { name: 'The relay', argv: building('relay'), done: 'The relay is built' },
      { name: 'The installer', argv: building('migrate'), done: 'The installer is built' },
    ],
    { env }
  )
  if (built || action === 'build') return built
  // Dex and the edge share PostgreSQL's network namespace: see the Compose file. The edge
  // is started with them: it is what answers on the issuer's name, and Dex is asked through it.
  const started = await run(['up', '-d', 'postgres', 'dex', 'edge'], {
    task: {
      doing: 'Starting PostgreSQL, Dex and the edge',
      done: 'PostgreSQL, Dex and the edge are started',
    },
  })
  // What the services said as they started, for when one does not become ready: the reason
  // is usually there, and often in the one beside the one that was waited for.
  const tail =
    (...services: string[]) =>
    async () => {
      for (const service of services)
        await run(['logs', '--tail', '40', service], { report: `What ${service} said last` })
    }
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
  const issuer = `http://${idp}:${edgePort}`
  await wait(
    () => r.healthy(`${issuer}/.well-known/openid-configuration`),
    timeout,
    r,
    'Dex',
    tail('dex', 'edge')
  )
  // The installer runs beside PostgreSQL and is let in by its socket. It installs the platform,
  // then the roles of the people the example names, so that there is somebody to sign in as.
  // What each of them did is its last line: the version installed, the count of changes.
  const lastLine = (fallback: string) => (said: string[]) => said.at(-1) ?? fallback
  const installed =
    (await beside([], {
      doing: 'Installing the platform',
      done: lastLine('The platform is installed'),
    })) ||
    (await beside(['apply', 'k8s', '--example'], {
      doing: 'Creating the roles of the example people',
      done: (said) => `The example people have their roles: ${lastLine('done')(said)}`,
    }))
  if (installed || action === 'init') return installed
  const served = await run(['up', '-d', 'relay'], {
    task: { doing: 'Starting the relay', done: 'The relay is started' },
  })
  if (served) return served
  await wait(
    () => r.healthy(`http://${api}:${edgePort}/health`),
    timeout,
    r,
    'The relay',
    tail('relay', 'edge')
  )
  const relayUrl = `ws://${api}:${edgePort}`
  // The example's site: built here, as it would be for a CDN, and served by the stack's own
  // static server behind the edge. It is last: the pages need the issuer and the relay.
  const site = `http://${app}:${edgePort}`
  if (example) {
    const files = await buildFiles(r, computed, {
      doing: `Building the ${example} site`,
      done: `The ${example} site is built`,
    })
    if (files.code) return files.code
    const published = await run(['up', '-d', 'site'], {
      task: { doing: 'Starting the site', done: 'The site is started' },
    })
    if (published) return published
    await wait(() => r.healthy(`${site}/`), timeout, r, 'The site', tail('site', 'edge'))
  }
  // The site, opened at its sign-in: the link carries nothing, and the issuer's form opens
  // with the administrator's address filled in. The password is typed, as it always is.
  const signIn = `${site}/#signin`
  last.word = example ? `Sign in at ${signIn}` : 'The stack is running'
  r.result(
    'The stack is running',
    [
      ...(example
        ? ([
            ['Site', site],
            ['Sign in', signIn],
          ] as [string, string][])
        : []),
      ['Issuer', issuer],
      ['Relay', relayUrl],
      ['PostgreSQL', `${db}:${postgresPort}`],
    ],
    [
      `Sign in as ${admin}, the break-glass administrator: Dex's form opens with the address filled in, and the password is PLATFORM_ADMIN_PASSWORD in ${r.envFile}.`,
      'Everybody else signs in through a connector: add an identity provider in deploy/dex/config.yaml.tmpl.',
      'PostgreSQL has no password: sign in with a token (`bun run cli token`), or administer the stack with `bun run cli deploy local admin <command>`.',
      example
        ? `The site's files are in examples/${example}/.dist: \`bun run cli deploy local ui\` builds them again, and they are served at once.`
        : `The interface is a static site: build it with \`bun run cli deploy local ui\` and publish packages/ui/dist to a CDN, with config.json pointing at ${relayUrl}.`,
    ]
  )
  return 0
}

/**
 * Builds the static interface and says what to publish. The bundle is the same everywhere;
 * the deployment's own names live in config.json and in the headers file beside it.
 */
async function buildInterface(r: DeployRuntime, computed: Record<string, string>): Promise<number> {
  const { code, where, relay } = await buildFiles(r, computed)
  if (code) return code
  r.print(
    `The interface is built in ${where}: publish those files to your CDN, including config.json
and the _headers file (Cloudflare Pages and Netlify read it; other CDNs need the same headers).
The relay is at ${relay || 'ws://localhost:8081'}; set PLATFORM_RELAY_URL to
its address before publishing, and PLATFORM_PUBLIC_URL to the address of the site.`
  )
  return 0
}

/** Writes the site's files for this deployment, and says where they are. */
async function buildFiles(
  r: DeployRuntime,
  computed: Record<string, string>,
  task?: RunOptions['task']
): Promise<{ code: number; where: string; relay: string }> {
  const env = {
    ...r.env,
    ...computed,
    PLATFORM_PUBLIC_URL: siteAddress(r, computed),
    PLATFORM_ISSUER: r.env.PLATFORM_ISSUER ?? r.env.OIDC_ISSUER ?? computed.PLATFORM_ISSUER ?? '',
    PLATFORM_RELAY_URL: r.env.PLATFORM_RELAY_URL ?? computed.PLATFORM_RELAY_URL ?? '',
  }
  // The example the deployment chose, if it chose one: the platform's own interface is
  // built otherwise.
  const example = r.env.PLATFORM_EXAMPLE ?? saved(r.envFile, 'PLATFORM_EXAMPLE') ?? ''
  const built = example
    ? await r.run(
        [
          'bun',
          'packages/cli/src/cli.ts',
          'ui',
          'build',
          `--dir=examples/${example}`,
          '--production',
        ],
        { env, task }
      )
    : await r.run(['bun', 'run', 'build:ui'], { env, task })
  return {
    code: built,
    where: example ? `examples/${example}/.dist` : 'packages/ui/dist',
    relay: env.PLATFORM_RELAY_URL,
  }
}
