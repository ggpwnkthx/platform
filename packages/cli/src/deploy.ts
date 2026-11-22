import { lookup } from 'node:dns/promises'
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as say from '@clack/prompts'
import { deploymentVariables } from '@platform/core'
import { isMap, isSeq, parseAllDocuments } from 'yaml'
import { z } from 'zod'
import { buildUi, ROOT, siteFiles } from './site.ts'

type Target = 'local' | 'k8s'
type Answers = Record<string, string>
const ENV_FILE = join(ROOT, '.env')
const COMPOSE_FILE = join(ROOT, 'deploy/compose/compose.yaml')

// ---------------------------------------------------------------------------- the settings

const name = z
  .string()
  .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, 'a name of letters, digits and hyphens')
const domain = z.string().regex(/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/, 'a domain name')
const port = z.coerce.number().int().min(1).max(65535)
const url = z.union([z.literal(''), z.url()])
const folder = z
  .string()
  .refine(
    (dir) => !dir || siteFiles(resolve(ROOT, dir)) !== null,
    'a folder that holds platform.json'
  )
interface Setting {
  name: string
  on: Target[]
  question?: string
  fallback?: string | ((answers: Answers) => string)
  check?: z.ZodType
  /** Asked only of a deployment that deploys a site of its own. */
  ownSite?: boolean
  secret?: boolean
}
const both: Target[] = ['local', 'k8s']
/**
 * The pieces a deployment is made of — the domain, the sub-domains, the ports — kept in .env.
 * The addresses are not kept: the issuer, the relay and the database follow from the pieces
 * every time, so they never fall out of step with the domain.
 */
const settings: Setting[] = [
  {
    name: 'PLATFORM_DOMAIN',
    on: ['local'],
    question: 'Domain of the deployment',
    fallback: 'localhost',
    check: domain,
  },
  { name: 'PLATFORM_DOMAIN', on: ['k8s'], question: 'Domain of the deployment', check: domain },
  {
    name: 'PLATFORM_IDP_HOST',
    on: both,
    question: 'Sub-domain for Dex, the issuer',
    fallback: 'idp',
    check: name,
  },
  {
    name: 'PLATFORM_API_HOST',
    on: both,
    question: 'Sub-domain for the relay, the API',
    fallback: 'api',
    check: name,
  },
  {
    name: 'PLATFORM_DB_HOST',
    on: both,
    question: 'Sub-domain for PostgreSQL',
    fallback: 'db',
    check: name,
  },
  { name: 'PLATFORM_IMAGE', on: ['k8s'], question: 'Relay image, in your registry' },
  {
    name: 'PLATFORM_PUBLIC_URL',
    on: both,
    question: 'URL of your site (empty to deploy one from a folder)',
    fallback: '',
    check: url,
  },
  {
    name: 'PLATFORM_SITE',
    on: both,
    ownSite: true,
    question: 'Folder of the site to deploy (empty for the platform’s own interface)',
    fallback: '',
    check: folder,
  },
  {
    name: 'PLATFORM_APP_HOST',
    on: both,
    ownSite: true,
    question: 'Sub-domain for the site',
    fallback: 'app',
    check: name,
  },
  {
    name: 'EDGE_PORT',
    on: ['local'],
    question: 'Port for the edge, on this machine',
    fallback: '8080',
    check: port,
  },
  {
    name: 'EDGE_TLS_PORT',
    on: ['local'],
    question: 'Port for the edge with TLS',
    fallback: '4433',
    check: port,
  },
  {
    name: 'POSTGRES_PORT',
    on: ['local'],
    question: 'Port for PostgreSQL',
    fallback: '5432',
    check: port,
  },
  {
    name: 'DATABASE_PORT',
    on: ['k8s'],
    question: 'Port PostgreSQL listens on',
    fallback: '5432',
    check: port,
  },
  {
    name: 'DEX_PORT',
    on: ['local'],
    question: 'Port for Dex, behind the edge',
    fallback: '5556',
    check: port,
  },
  {
    name: 'RELAY_PORT',
    on: ['local'],
    question: 'Port for the relay, behind the edge',
    fallback: '8081',
    check: port,
  },
  {
    name: 'PLATFORM_ADMIN',
    on: ['local'],
    question: 'Administrator, as an address',
    fallback: (a) => `admin@${a.PLATFORM_DOMAIN ?? 'localhost'}`,
    // The address Dex knows the administrator by, and their role: admin@localhost is one.
    check: z.string().regex(/^[^@\s]+@[^@\s]+$/, 'an address, like admin@example.com'),
  },
  { name: 'PLATFORM_ADMIN_PASSWORD', on: ['local'], secret: true },
]
const readEnv = (file = ENV_FILE): Answers =>
  existsSync(file)
    ? Object.fromEntries(
        [...readFileSync(file, 'utf8').matchAll(/^([A-Z_][A-Z0-9_]*)=(.*)$/gm)].map((m) => [
          m[1]!,
          m[2]!.replace(/^"(.*)"$/, '$1'),
        ])
      )
    : {}
const examples = () =>
  readdirSync(join(ROOT, 'examples'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && siteFiles(join(ROOT, 'examples', entry.name)))
    .map((entry) => `examples/${entry.name}`)

/** The settings of a deployment: what is given, then the environment, then .env. A first run asks for the rest and writes it down. */
export async function ensureSettings(
  target: Target,
  given: Answers = {},
  env: Answers = process.env as Answers,
  file = ENV_FILE
): Promise<Answers> {
  const saved = readEnv(file)
  const first = !existsSync(file) && process.stdin.isTTY && process.stderr.isTTY
  const answers: Answers = { ...saved }
  for (const setting of settings.filter((s) => s.on.includes(target))) {
    let value = given[setting.name] ?? env[setting.name] ?? saved[setting.name]
    const fallback =
      typeof setting.fallback === 'function' ? setting.fallback(answers) : setting.fallback
    const valid = (text: string) => setting.check?.safeParse(text).error?.issues[0]?.message
    if (setting.ownSite && answers.PLATFORM_PUBLIC_URL) continue
    if (value === undefined && setting.secret)
      value = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url')
    if (value === undefined && first && setting.question) {
      const hint = setting.name === 'PLATFORM_SITE' ? ` (${examples().join(', ')})` : ''
      const asked = await say.text({
        message: setting.question + hint,
        initialValue: fallback,
        validate: (text) => valid(text ?? ''),
      })
      if (say.isCancel(asked)) throw new Error('Cancelled')
      value = asked ?? ''
    }
    value ??= fallback
    if (value === undefined)
      throw new Error(`${setting.name} is required: ${setting.question ?? 'set it in .env'}`)
    const problem = valid(value)
    if (problem) throw new Error(`${setting.name}=${value}: ${problem}`)
    answers[setting.name] = value
  }
  // The file holds secrets: it is written for its owner alone, and kept out of git.
  if (JSON.stringify(answers) !== JSON.stringify(saved)) {
    writeFileSync(
      file,
      `${Object.entries(answers)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')}\n`,
      { mode: 0o600 }
    )
    chmodSync(file, 0o600)
  }
  return answers
}

/** The addresses that follow from the pieces: each service answers on its own sub-domain. */
export function addresses(target: Target, a: Answers) {
  const host = (sub: string) => `${a[sub]}.${a.PLATFORM_DOMAIN}`
  const [http, ws, edge] =
    target === 'local' ? ['http', 'ws', `:${a.EDGE_PORT}`] : ['https', 'wss', '']
  return {
    issuer: `${http}://${host('PLATFORM_IDP_HOST')}${edge}`,
    relay: `${ws}://${host('PLATFORM_API_HOST')}${edge}`,
    site: a.PLATFORM_PUBLIC_URL || `${http}://${host('PLATFORM_APP_HOST')}${edge}`,
    database: host('PLATFORM_DB_HOST'),
    siteFolder: a.PLATFORM_PUBLIC_URL || !a.PLATFORM_SITE ? null : resolve(ROOT, a.PLATFORM_SITE),
  }
}
/** Where the local stack's PostgreSQL answers, for the database commands. */
export function localDatabase(): Answers {
  const a = {
    PLATFORM_DOMAIN: 'localhost',
    PLATFORM_DB_HOST: 'db',
    POSTGRES_PORT: '5432',
    ...readEnv(),
  }
  const loopback = a.PLATFORM_DOMAIN === 'localhost'
  return {
    DATABASE_HOST: loopback ? '127.0.0.1' : `${a.PLATFORM_DB_HOST}.${a.PLATFORM_DOMAIN}`,
    DATABASE_PORT: a.POSTGRES_PORT,
    DATABASE_NAME: 'platform',
    DATABASE_SSL: 'disable',
  }
}

// ---------------------------------------------------------------------------- running things

async function sh(
  argv: string[],
  options: { env?: Record<string, string | undefined>; quiet?: boolean; input?: string } = {}
): Promise<number> {
  const child = Bun.spawn(argv, {
    cwd: ROOT,
    env: options.env ?? process.env,
    stdin: options.input === undefined ? 'inherit' : new Blob([options.input]),
    stdout: options.quiet ? 'ignore' : 'inherit',
    stderr: options.quiet ? 'ignore' : 'inherit',
  })
  return child.exited
}
const flags = (args: string[], known: string[]) => {
  const values: Answers = {}
  const rest: string[] = []
  for (const arg of args) {
    const [, key, value] = /^--([\w-]+)=(.*)$/.exec(arg) ?? []
    if (key && known.includes(key)) values[key] = value!
    else rest.push(arg)
  }
  return { values, rest }
}
async function until(what: string, seconds: number, check: () => Promise<boolean>) {
  const waiting = say.spinner()
  waiting.start(`Waiting for ${what}`)
  for (const deadline = Date.now() + seconds * 1000; Date.now() < deadline; await Bun.sleep(1000))
    if (await check().catch(() => false)) return waiting.stop(`${what} is ready`)
  waiting.stop(`No answer from ${what} after ${seconds}s`)
  throw new Error(`${what} did not become ready. \`deploy local logs\` says what it said.`)
}
const step = async (doing: string, code: Promise<number>) => {
  say.log.step(doing)
  if (await code) throw new Error(`${doing} failed`)
}

// -------------------------------------------------------------------------- the local stack

const LOCAL = ['up', 'init', 'admin', 'ui', 'validate', 'build', 'status', 'logs', 'down']
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
  const env = {
    ...process.env,
    ...a,
    PLATFORM_PUBLIC_ORIGIN: new URL(at.site).origin,
    // Dex keeps one account with a password, the break-glass administrator: only its hash leaves this file.
    DEX_ADMIN_HASH: await Bun.password.hash(a.PLATFORM_ADMIN_PASSWORD!, {
      algorithm: 'bcrypt',
      cost: 10,
    }),
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
  const names = [at.issuer, at.relay, at.site].map((address) => new URL(address).hostname)
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
      `Sign in as ${a.PLATFORM_ADMIN}, the break-glass administrator; the password is PLATFORM_ADMIN_PASSWORD in ${ENV_FILE}.`,
      'Everybody else signs in through a connector: add an identity provider in deploy/dex/config.yaml.tmpl.',
      'PostgreSQL has no password: sign in with a token (`bun run cli token`), or administer the stack with `bun run cli deploy local admin <command>`.',
    ].join('\n'),
    'The stack is running'
  )
  say.outro(a.PLATFORM_PUBLIC_URL ? 'The stack is running' : `The site is at ${at.site}`)
  return 0
}

// ------------------------------------------------------------------------------ Kubernetes

export interface ManifestOptions {
  image: string
  publicUrl: string
  oidcIssuer: string
  databaseHost: string
  databasePort: string
  namespace: string
}
const https = (what: string) =>
  z
    .url({ protocol: /^https$/, error: `${what} must be an HTTPS URL` })
    .refine((u) => !new URL(u).username, `${what} must carry no credentials`)
const manifestOptions = z.object({
  image: z
    .string()
    .regex(/^\S+$/, '--image or PLATFORM_IMAGE must name your built and pushed image')
    .refine(
      (i) => !i.includes('YOUR_REGISTRY'),
      '--image or PLATFORM_IMAGE must name your built and pushed image'
    ),
  publicUrl: https('--public-url or PUBLIC_URL'),
  oidcIssuer: https('--oidc-issuer or OIDC_ISSUER'),
  databaseHost: z
    .string()
    .regex(
      /^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])$/,
      '--database-host must be a host name or an IP address'
    ),
  databasePort: z.string().regex(/^\d{1,5}$/, 'Invalid database port'),
  namespace: name.max(63),
})
/** deploy/k8s/deployment.yaml, configured: the image, the namespace, the upstream and the one origin the relay allows. */
export function renderKubernetes(options: ManifestOptions): string {
  const o = manifestOptions.parse(options)
  const documents = parseAllDocuments(
    readFileSync(join(ROOT, 'deploy/k8s/deployment.yaml'), 'utf8')
  )
  for (const document of documents) document.setIn(['metadata', 'namespace'], o.namespace)
  const container = documents[0]?.getIn(['spec', 'template', 'spec', 'containers', 0])
  if (!isMap(container)) throw new Error("The relay's manifest has no container")
  container.set('image', o.image)
  const environment = container.get('env')
  if (!isSeq(environment)) throw new Error("The relay's manifest has no environment")
  const values: Answers = {
    RELAY_UPSTREAM: `${o.databaseHost}:${o.databasePort}`,
    RELAY_ORIGINS: o.publicUrl,
  }
  for (const entry of environment.items)
    if (isMap(entry) && String(entry.get('name')) in values)
      entry.set('value', values[String(entry.get('name'))])
  return documents.map((document) => document.toString().replace(/^---\r?\n/, '')).join('\n---\n')
}

const K8S = ['render', 'validate', 'diff', 'apply', 'status', 'logs', 'down']
/** Kubernetes, using deploy/k8s/deployment.yaml and the current kubectl context. PostgreSQL 18 and Dex are the operator's to run. */
export async function kubernetes(action: string, args: string[]): Promise<number> {
  if (!K8S.includes(action))
    throw new Error(`Unknown k8s action: ${action}. One of: ${K8S.join(', ')}.`)
  const { values, rest } = flags(args, [
    'namespace',
    'domain',
    'image',
    'public-url',
    'oidc-issuer',
    'database-host',
    'database-port',
    'timeout',
  ])
  if (rest.length && action !== 'logs') throw new Error(`Unexpected argument: ${rest.join(' ')}`)
  const namespace = values.namespace ?? 'default'
  const kubectl = (more: string[], input?: string) => {
    if (!Bun.which('kubectl')) throw new Error('kubectl is not installed or not on PATH')
    return sh(['kubectl', '-n', namespace, ...more], { input })
  }
  if (action === 'status')
    return kubectl(['get', 'deployment,service,pod', '-l', 'app=platform', '-o', 'wide'])
  if (action === 'logs') return kubectl(['logs', 'deployment/platform-relay', ...rest])
  if (action === 'down')
    return kubectl([
      'delete',
      'deployment/platform-relay',
      'service/platform-relay',
      '--ignore-not-found',
    ])
  const given = {
    PLATFORM_DOMAIN: values.domain,
    PLATFORM_IMAGE: values.image,
    // PUBLIC_URL is the name earlier versions kept the site's address under.
    PLATFORM_PUBLIC_URL: values['public-url'] ?? process.env.PUBLIC_URL ?? readEnv().PUBLIC_URL,
    DATABASE_PORT: values['database-port'],
  }
  const a = await ensureSettings(
    'k8s',
    Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined)) as Answers
  )
  const at = addresses('k8s', a)
  const issuer = values['oidc-issuer'] ?? process.env.OIDC_ISSUER ?? at.issuer
  const manifest = renderKubernetes({
    image: a.PLATFORM_IMAGE!,
    publicUrl: at.site,
    oidcIssuer: issuer,
    databaseHost: values['database-host'] ?? process.env.DATABASE_HOST ?? at.database,
    databasePort: a.DATABASE_PORT!,
    namespace,
  })
  if (action === 'render') {
    console.log(manifest)
    return 0
  }
  if (action === 'diff') return kubectl(['diff', '-f', '-'], manifest)
  if (action === 'validate') return kubectl(['apply', '--dry-run=server', '-f', '-'], manifest)
  const failed =
    (await kubectl(['apply', '-f', '-'], manifest)) ||
    (await kubectl([
      'rollout',
      'status',
      'deployment/platform-relay',
      `--timeout=${Number(values.timeout ?? 120)}s`,
    ]))
  if (failed) return failed
  console.log(`The relay is deployed, on ${at.relay}. The pages reach PostgreSQL through it, and sign in through the issuer at ${issuer}.
Put the relay behind that address: deploy/k8s/ingress.yaml is an example of an ingress that serves it, with the certificate for the name.`)
  return 0
}

export { deploymentVariables }
