/** Kubernetes: the relay's manifests, and what kubectl does with them. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type DeployRuntime, noExtra, option, ROOT, seconds } from './runtime.ts'

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
    .replace('YOUR_REGISTRY/platform-relay:2.3.0', JSON.stringify(options.image))
    .replace('"https://platform.example.com"', JSON.stringify(options.publicUrl))
    .replace(
      '"postgres.example.com:5432"',
      JSON.stringify(`${options.databaseHost}:${options.databasePort}`)
    )
    .replace(
      '{ name: DATABASE_NAME, value: platform }',
      `{ name: DATABASE_NAME, value: ${JSON.stringify(options.databaseName)} }`
    )
}
export async function kubernetes(
  action: string,
  args: string[],
  r: DeployRuntime
): Promise<number> {
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
  if (action === 'logs') return run(['logs', 'deployment/platform-relay', ...args])
  if (action === 'down')
    return run([
      'delete',
      'deployment/platform-relay',
      'service/platform-relay',
      '--ignore-not-found',
    ])
  if (action === 'diff') return run(['diff', '-f', '-'], manifest)
  if (action === 'validate') return run(['apply', '--dry-run=server', '-f', '-'], manifest)
  const applied = await run(['apply', '-f', '-'], manifest)
  if (applied) return applied
  return run(['rollout', 'status', 'deployment/platform-relay', `--timeout=${timeout}s`])
}
