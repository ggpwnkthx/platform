/** The local stack: Docker Compose or Podman Compose, with PostgreSQL, Dex and the relay. */
import { existsSync, readFileSync } from 'node:fs'
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

/** The example people the local stack's Dex keeps, and where each one's password is saved. */
const LOCAL_PEOPLE = {
  DEX_ADMIN_HASH: 'PLATFORM_ADMIN_PASSWORD',
  DEX_ALICE_HASH: 'ALICE_PASSWORD',
  DEX_BOB_HASH: 'BOB_PASSWORD',
}
/** The local stack's administrator password, if one was supplied or generated earlier. */
function administratorPassword(r: DeployRuntime): string | undefined {
  // The environment wins over the saved file; within either, a password file wins over a value.
  const passwordFile =
    r.env.POSTGRES_PASSWORD_FILE ??
    (r.env.POSTGRES_PASSWORD ? undefined : saved(r.envFile, 'POSTGRES_PASSWORD_FILE'))
  const password = passwordFile
    ? readFileSync(passwordFile, 'utf8').trimEnd()
    : r.env.POSTGRES_PASSWORD || saved(r.envFile, 'POSTGRES_PASSWORD')
  if (passwordFile && !password) throw new Error(`${passwordFile} is empty`)
  return password
}
/** Where the local stack publishes PostgreSQL, for commands that manage what is inside it. */
export function localDatabase(r: DeployRuntime = runtime) {
  return {
    host: '127.0.0.1',
    port: r.env.POSTGRES_PORT ?? saved(r.envFile, 'POSTGRES_PORT') ?? '5432',
    name: 'platform',
    username: 'postgres',
    password: administratorPassword(r),
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
  label: string
) {
  // Bounded attempts make the timeout independent of an injected/test clock.
  const deadline = Date.now() + timeout * 1000
  for (let i = 0; i < timeout && Date.now() < deadline; i++) {
    if (await check()) return
    await r.sleep(1000)
  }
  throw new Error(`${label} did not become ready. Check deploy local logs.`)
}
export async function local(action: string, args: string[], r: DeployRuntime): Promise<number> {
  const engine = option(args, 'engine') ?? 'auto'
  const timeout = seconds(option(args, 'timeout'))
  if (!['up', 'init', 'ui', 'validate', 'build', 'status', 'logs', 'down'].includes(action))
    throw new Error(`Unknown local action: ${action}`)
  if (!['logs', 'down'].includes(action)) noExtra(args)
  // The interface is a static site: building it needs no container, only the toolchain.
  if (action === 'ui') return buildInterface(r)
  let password = administratorPassword(r)
  const setting = (name: string, fallback: string) => {
    const value = r.env[name] ?? saved(r.envFile, name) ?? fallback
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
      throw new Error(`Invalid ${name}`)
    return value
  }
  const dexPort = setting('DEX_PORT', '5556')
  const relayPort = setting('RELAY_PORT', '8081')
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
  // Generated only once the options are valid and a Compose tool is found. Down/status/logs
  // must work without a secret; Compose still interpolates this required variable.
  const prepares = ['up', 'init', 'build', 'validate'].includes(action)
  if (!password && prepares) password = generate('POSTGRES_PASSWORD', r)
  const env: Record<string, string | undefined> = {
    ...r.env,
    POSTGRES_PASSWORD: password ?? 'unused-for-inspection',
    DEX_PORT: dexPort,
    RELAY_PORT: relayPort,
    // The only origin the relay allows: the address the site is served from.
    PLATFORM_PUBLIC_ORIGIN:
      r.env.PLATFORM_PUBLIC_URL ?? r.env.PUBLIC_URL ?? 'http://localhost:5173',
  }
  // Dex is given only hashes. The passwords stay in the saved file for the people to read.
  if (prepares)
    for (const [hash, name] of Object.entries(LOCAL_PEOPLE))
      env[hash] = await r.hash(r.env[name] || saved(r.envFile, name) || generate(name, r))
  const run = (a: string[], extra: RunOptions = {}) => r.run([...cmd, ...a], { env, ...extra })
  if (action === 'validate') return run(['config'], { quiet: true })
  if (action === 'status') return run(['ps'])
  if (action === 'logs') return run(['logs', ...args])
  if (action === 'down') return run(['down', ...args])
  // The installer's image is built with the rest: its service sits behind the install profile.
  const built = await r.run(
    [
      ...cmd.slice(0, base),
      '--profile',
      'install',
      ...cmd.slice(base),
      'build',
      'postgres',
      'relay',
      'migrate',
    ],
    { env }
  )
  if (built || action === 'build') return built
  // Dex shares PostgreSQL's network namespace: see the Compose file.
  const started = await run(['up', '-d', 'postgres', 'dex'])
  if (started) return started
  await wait(
    async () =>
      (await run(['exec', '-T', 'postgres', 'pg_isready', '-U', 'postgres', '-d', 'platform'], {
        quiet: true,
      })) === 0,
    timeout,
    r,
    'PostgreSQL'
  )
  const issuer = `http://localhost:${dexPort}/dex`
  await wait(() => r.healthy(`${issuer}/.well-known/openid-configuration`), timeout, r, 'Dex')
  // The credentials reach the installer through the Compose file's interpolation, not through
  // `run -e NAME`, which podman-compose cannot parse, nor `-e NAME=value`, which would show them.
  const installed = await r.run(
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
    ],
    { env }
  )
  if (installed || action === 'init') return installed
  const served = await run(['up', '-d', 'relay'])
  if (served) return served
  await wait(() => r.healthy(`http://localhost:${relayPort}/health`), timeout, r, 'The relay')
  const relayUrl = `ws://localhost:${relayPort}`
  r.print(
    `PostgreSQL, Dex and the relay are running. The relay answers at ${relayUrl}.
The interface is a static site: build it with \`bun run cli deploy local ui\` and publish the
files in packages/ui/dist to a CDN, with config.json pointing at ${relayUrl}.
People sign in through Dex at ${issuer}.
Create the example roles: bun run cli apply local --example
Then sign in as admin@example.com, alice@example.com or bob@example.com with the passwords saved in ${r.envFile}.`
  )
  return 0
}

/**
 * Builds the static interface and says what to publish. The bundle is the same everywhere;
 * the deployment's own names live in config.json and in the headers file beside it.
 */
async function buildInterface(r: DeployRuntime): Promise<number> {
  const env = {
    ...r.env,
    PLATFORM_PUBLIC_URL: r.env.PLATFORM_PUBLIC_URL ?? r.env.PUBLIC_URL ?? '',
    PLATFORM_ISSUER: r.env.PLATFORM_ISSUER ?? r.env.OIDC_ISSUER ?? '',
    PLATFORM_RELAY_URL: r.env.PLATFORM_RELAY_URL ?? '',
  }
  const built = await r.run(['bun', 'run', 'build:ui'], { env })
  if (built) return built
  r.print(
    `The interface is built in packages/ui/dist: publish those files to your CDN, including config.json
and the _headers file (Cloudflare Pages and Netlify read it; other CDNs need the same headers).
The relay is at ${env.PLATFORM_RELAY_URL || 'ws://localhost:8081'}; set PLATFORM_RELAY_URL to
its address before publishing, and PLATFORM_PUBLIC_URL to the address of the site.`
  )
  return 0
}
