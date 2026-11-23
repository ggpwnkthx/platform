import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isMap, isSeq, parseAllDocuments } from 'yaml'
import { z } from 'zod'
import { ROOT } from '../site.ts'
import { addresses, ensureSettings, readEnv, type Answers } from './settings.ts'
import { flags, sh } from './shell.ts'

export interface ManifestOptions {
  image: string
  publicUrl: string
  oidcIssuer: string
  databaseHost: string
  databasePort: string
  namespace: string
}
const name = z
  .string()
  .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, 'a name of letters, digits and hyphens')
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
