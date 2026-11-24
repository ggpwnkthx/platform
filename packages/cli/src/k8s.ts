import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { addresses, flags, ROOT, settle, sh } from './settings.ts'

/**
 * Kubernetes: the relay, from deploy/k8s/deployment.yaml and the current kubectl context.
 * PostgreSQL 18 and Dex are the operator's to run, and the site is files on a CDN.
 */
const ACTIONS = ['render', 'validate', 'diff', 'apply', 'status', 'logs', 'down']
export interface Rendering {
  image: string
  publicUrl: string
  database: string
  namespace: string
}
/** The manifests with the deployment's own names in the places the file marks. */
export function render(o: Rendering): string {
  if (!/^https:\/\//.test(o.publicUrl))
    throw new Error(`The site must be served over https: ${o.publicUrl} is not.`)
  if (!o.image || /YOUR_REGISTRY/.test(o.image))
    throw new Error('PLATFORM_IMAGE must name the relay image in your registry.')
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(o.namespace))
    throw new Error(`${o.namespace} is not a namespace.`)
  const said: Record<string, string> = {
    IMAGE: o.image,
    ORIGIN: new URL(o.publicUrl).origin,
    UPSTREAM: o.database,
    NAMESPACE: o.namespace,
  }
  return readFileSync(join(ROOT, 'deploy/k8s/deployment.yaml'), 'utf8').replace(
    /\$\{(\w+)\}/g,
    (_, key) => said[key] ?? `\${${key}}`
  )
}

export async function kubernetes(action: string, args: string[]): Promise<number> {
  if (!ACTIONS.includes(action))
    throw new Error(`Unknown k8s action: ${action}. One of: ${ACTIONS.join(', ')}.`)
  const { values, rest } = flags(args, [
    'namespace',
    'domain',
    'image',
    'public-url',
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
    PLATFORM_PUBLIC_URL: values['public-url'],
    DATABASE_PORT: values['database-port'],
  }
  const a = settle(
    'k8s',
    Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined)) as Record<
      string,
      string
    >
  )
  const at = addresses('k8s', a)
  const manifest = render({
    image: a.PLATFORM_IMAGE!,
    publicUrl: at.site,
    database: `${values['database-host'] ?? at.database}:${a.DATABASE_PORT}`,
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
  console.log(`The relay is deployed, on ${at.relay}. The pages reach PostgreSQL through it, and sign in through the issuer at ${at.issuer}.
Put the relay behind that address: deploy/k8s/ingress.yaml is an example of an ingress that serves it, with the certificate for the name.`)
  return 0
}
