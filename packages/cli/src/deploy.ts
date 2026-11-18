import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../..')
export const DEPLOY_HELP = `platform deploy <local|k8s> <action> [options]

  local  Docker Compose or Podman Compose, using deploy/compose/compose.yaml.
    up          Build, start PostgreSQL 18 and Dex, install the database, then start the relay
                and the interface.
    init        Build/start PostgreSQL and Dex and run the idempotent database installer only.
    validate    Validate the Compose configuration without printing its secrets.
    build       Build the PostgreSQL, interface and installer images.
    status      Show containers.
    logs        Show logs; trailing Compose arguments are accepted (for example -f ui).
    down        Stop containers; volumes are retained unless you explicitly pass --volumes.
    --engine=auto|docker|podman  Default: auto. Also supports standalone Compose tools.
    --timeout=120              Startup timeout in seconds, per readiness check.
    POSTGRES_PASSWORD or POSTGRES_PASSWORD_FILE is the database administrator password. When
    neither is set, up/init/build/validate generate one and save it in .env for later runs.
    The interface and the relay receive no password. People sign in through Dex, at DEX_PORT
    (5556), and PostgreSQL takes only tokens from the relay's network. The stack's Dex
    keeps three example people: admin@example.com, alice@example.com and bob@example.com, whose
    passwords are PLATFORM_ADMIN_PASSWORD, ALICE_PASSWORD and BOB_PASSWORD, generated likewise.

  k8s    Kubernetes, using deploy/k8s/deployment.yaml and your current kubectl context.
    render      Print configured manifests without contacting a cluster.
    validate    Server-side dry run; needs the target cluster.
    diff        Show the server-side diff (exit 1 means differences).
    apply       Apply manifests and wait for deployment/platform to roll out.
    status      Show deployment, service and pods.
    logs        Show deployment logs; trailing kubectl arguments are accepted.
    down        Delete the interface's deployment and service; PostgreSQL is external.
    --namespace=default        Namespace must already exist.
    --image=REGISTRY/platform-ui:2.1.0  Or PLATFORM_IMAGE: the interface image (Dockerfile target ui).
    --public-url=https://...        Or PUBLIC_URL.
    --oidc-issuer=https://...       Or OIDC_ISSUER: your Dex, which PostgreSQL must trust too.
    --database-host=HOST            Or DATABASE_HOST.
    --database-name=platform        Or DATABASE_NAME.
    --database-port=5432            Or DATABASE_PORT.
    --timeout=120                   Rollout timeout in seconds.
    PostgreSQL 18 and Dex are yours to run. Install the database separately with your own
    operator credentials. Each pod runs the interface and a relay that forwards to
    DATABASE_HOST:DATABASE_PORT; set PLATFORM_TOKEN_ONLY_FROM (or your own pg_hba rule) to the
    pods' address range, so that from there PostgreSQL accepts tokens and nothing else.

  bun run cli deploy local up
  bun run cli deploy local logs -f ui
  bun run cli deploy k8s apply --namespace=platform --image=registry/platform-ui:2.1.0 \\
    --public-url=https://platform.example.com --database-host=db.example.com \\
    --oidc-issuer=https://sso.example.com/dex
`
type RunOptions = { env?: Record<string, string | undefined>; quiet?: boolean; input?: string }
export type DeployRuntime = {
  run(argv: string[], options?: RunOptions): Promise<number>
  which(name: string): string | null
  env: Record<string, string | undefined>
  /** Where generated values are kept, so that later runs find the same ones. */
  envFile: string
  print(text: string): void
  sleep(ms: number): Promise<void>
  healthy(url: string): Promise<boolean>
  /** A bcrypt hash, the form Dex keeps a local password in. */
  hash(password: string): Promise<string>
}
const runtime: DeployRuntime = {
  async run(argv, options = {}) {
    const child = Bun.spawn(argv, {
      cwd: ROOT,
      env: options.env ?? process.env,
      stdin: options.input === undefined ? 'inherit' : new Blob([options.input]),
      stdout: options.quiet ? 'ignore' : 'inherit',
      stderr: options.quiet ? 'ignore' : 'inherit',
    })
    return child.exited
  },
  which: Bun.which,
  env: process.env,
  envFile: join(ROOT, '.env'),
  print: console.log,
  sleep: async (ms) => {
    await Bun.sleep(ms)
  },
  healthy: async (url) =>
    fetch(url, { signal: AbortSignal.timeout(2000) }).then(
      (r) => r.ok,
      () => false
    ),
  hash: (password) => Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 }),
}
function option(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const at = args.findIndex((a) => a === `--${name}` || a.startsWith(prefix))
  if (at < 0) return undefined
  const arg = args.splice(at, 1)[0]!
  const value = arg.startsWith(prefix) ? arg.slice(prefix.length) : args.splice(at, 1)[0]
  if (!value || value.startsWith('--')) throw new Error(`--${name} needs a value`)
  if (args.some((a) => a === `--${name}` || a.startsWith(prefix)))
    throw new Error(`Repeated --${name}`)
  return value
}
function seconds(value: string | undefined): number {
  const n = Number(value ?? 120)
  if (!Number.isInteger(n) || n < 1 || n > 1800) throw new Error('--timeout must be 1–1800 seconds')
  return n
}
function noExtra(args: string[]) {
  if (args.length) throw new Error(`Unexpected arguments: ${args.join(' ')}`)
}
/** The value a dotenv file gives a name; the last assignment wins, as it does for Compose. */
function saved(file: string, name: string): string | undefined {
  if (!existsSync(file)) return undefined
  let value: string | undefined
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m?.[1] === name) value = m[2]!.replace(/^(['"])(.*)\1$/, '$2')
  }
  return value || undefined
}
/** Appends a value to the saved file, which is private to its owner. */
function save(name: string, value: string, r: DeployRuntime) {
  const text = existsSync(r.envFile) ? readFileSync(r.envFile, 'utf8') : ''
  appendFileSync(r.envFile, `${text && !text.endsWith('\n') ? '\n' : ''}${name}=${value}\n`, {
    mode: 0o600,
  })
}
/** A required value nobody supplied is generated once and saved, never printed. */
function generate(name: string, r: DeployRuntime): string {
  const value = randomBytes(24).toString('base64url')
  save(name, value, r)
  r.print(`Generated ${name} and saved it in ${r.envFile}.`)
  return value
}
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
async function local(action: string, args: string[], r: DeployRuntime): Promise<number> {
  const engine = option(args, 'engine') ?? 'auto'
  const timeout = seconds(option(args, 'timeout'))
  if (!['up', 'init', 'validate', 'build', 'status', 'logs', 'down'].includes(action))
    throw new Error(`Unknown local action: ${action}`)
  if (!['logs', 'down'].includes(action)) noExtra(args)
  let password = administratorPassword(r)
  const setting = (name: string, fallback: string) => {
    const value = r.env[name] ?? saved(r.envFile, name) ?? fallback
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
      throw new Error(`Invalid ${name}`)
    return value
  }
  const port = setting('PLATFORM_HTTP_PORT', '8080')
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
    PLATFORM_HTTP_PORT: port,
    DEX_PORT: dexPort,
    RELAY_PORT: relayPort,
    // The only origin the relay allows: the address the site is served from.
    PLATFORM_PUBLIC_ORIGIN: r.env.PLATFORM_PUBLIC_URL ?? r.env.PUBLIC_URL ?? 'http://localhost:8080',
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
      'ui',
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
  const served = await run(['up', '-d', 'relay', 'ui'])
  if (served) return served
  const url = `http://localhost:${port}`
  await wait(() => r.healthy(`${url}/health`), timeout, r, 'The interface')
  r.print(
    `Platform running at ${url}. People sign in through Dex at ${issuer}.
Create the example roles: bun run cli apply local examples/newsroom.json
Then sign in as admin@example.com, alice@example.com or bob@example.com with the passwords saved in ${r.envFile}.`
  )
  return 0
}
export function renderKubernetes(options: {
  image: string
  publicUrl: string
  oidcIssuer: string
  databaseHost: string
  databaseName: string
  databasePort: string
  namespace?: string
}): string {
  if (!options.image || options.image.includes('YOUR_REGISTRY') || /[\s\0]/.test(options.image))
    throw new Error('--image or PLATFORM_IMAGE must specify your built/pushed image')
  if (!options.publicUrl) throw new Error('--public-url or PUBLIC_URL is required')
  const namespace = options.namespace ?? 'default'
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(namespace) || namespace.length > 63)
    throw new Error('Invalid namespace')
  const url = new URL(options.publicUrl)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Kubernetes PUBLIC_URL must be an HTTPS URL without credentials')
  if (!options.oidcIssuer) throw new Error('--oidc-issuer or OIDC_ISSUER is required')
  const issuer = new URL(options.oidcIssuer)
  if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.search)
    throw new Error('Kubernetes OIDC_ISSUER must be an HTTPS URL without credentials')
  if (!options.databaseHost || options.databaseHost === 'postgres.example.com')
    throw new Error('--database-host or DATABASE_HOST is required')
  // The relay is told where to connect in one argument: a host name, an IPv4 address, or an
  // IPv6 address in brackets, and nothing that could become another argument.
  if (!/^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])$/.test(options.databaseHost))
    throw new Error('--database-host must be a host name or an IP address')
  if (!options.databaseName || options.databaseName.includes('\0'))
    throw new Error('Invalid database name')
  if (
    !/^\d+$/.test(options.databasePort) ||
    Number(options.databasePort) < 1 ||
    Number(options.databasePort) > 65535
  )
    throw new Error('Invalid database port')
  return readFileSync(join(ROOT, 'deploy/k8s/deployment.yaml'), 'utf8')
    .replaceAll(
      'metadata:\n  name: platform',
      `metadata:\n  namespace: ${JSON.stringify(namespace)}\n  name: platform`
    )
    .replace('YOUR_REGISTRY/platform-ui:2.1.0', JSON.stringify(options.image))
    .replace('"https://platform.example.com"', JSON.stringify(options.publicUrl))
    .replace('"https://sso.example.com/dex"', JSON.stringify(options.oidcIssuer))
    .replace(
      '"tcp:postgres.example.com:5432"',
      JSON.stringify(`tcp:${options.databaseHost}:${options.databasePort}`)
    )
    .replace(
      '{ name: DATABASE_NAME, value: platform }',
      `{ name: DATABASE_NAME, value: ${JSON.stringify(options.databaseName)} }`
    )
}
async function kubernetes(action: string, args: string[], r: DeployRuntime): Promise<number> {
  const namespace = option(args, 'namespace') ?? 'default'
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(namespace) || namespace.length > 63)
    throw new Error('Invalid namespace')
  const timeout = seconds(option(args, 'timeout'))
  const image = option(args, 'image') ?? r.env.PLATFORM_IMAGE ?? ''
  const publicUrl = option(args, 'public-url') ?? r.env.PUBLIC_URL ?? ''
  const oidcIssuer = option(args, 'oidc-issuer') ?? r.env.OIDC_ISSUER ?? ''
  const databaseHost = option(args, 'database-host') ?? r.env.DATABASE_HOST ?? ''
  const databaseName = option(args, 'database-name') ?? r.env.DATABASE_NAME ?? 'platform'
  const databasePort = option(args, 'database-port') ?? r.env.DATABASE_PORT ?? '5432'
  if (!['render', 'validate', 'diff', 'apply', 'status', 'logs', 'down'].includes(action))
    throw new Error(`Unknown k8s action: ${action}`)
  if (action !== 'logs') noExtra(args)
  const manifest = ['render', 'validate', 'diff', 'apply'].includes(action)
    ? renderKubernetes({
        image,
        publicUrl,
        oidcIssuer,
        databaseHost,
        databaseName,
        databasePort,
        namespace,
      })
    : ''
  if (action === 'render') {
    r.print(manifest)
    return 0
  }
  const k = r.which('kubectl')
  if (!k) throw new Error('kubectl is not installed or not on PATH')
  const run = (a: string[], input?: string) => r.run([k, '-n', namespace, ...a], { input })
  if (action === 'status')
    return run(['get', 'deployment,service,pod', '-l', 'app=platform', '-o', 'wide'])
  if (action === 'logs') return run(['logs', 'deployment/platform', ...args])
  if (action === 'down')
    return run(['delete', 'deployment/platform', 'service/platform', '--ignore-not-found'])
  if (action === 'diff') return run(['diff', '-f', '-'], manifest)
  if (action === 'validate') return run(['apply', '--dry-run=server', '-f', '-'], manifest)
  const applied = await run(['apply', '-f', '-'], manifest)
  if (applied) return applied
  return run(['rollout', 'status', 'deployment/platform', `--timeout=${timeout}s`])
}
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
