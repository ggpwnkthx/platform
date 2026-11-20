/** Kubernetes: the relay's manifests, and what kubectl does with them. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type DeployRuntime, noExtra, option, ROOT, seconds } from './runtime.ts'
import { computedValues, ensureConfig, settingValue } from './config.ts'

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
      '"db.YOUR_DOMAIN:5432"',
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
  const given = {
    PLATFORM_DOMAIN: option(args, 'domain'),
    PLATFORM_IMAGE: option(args, 'image'),
    PUBLIC_URL: option(args, 'public-url'),
    OIDC_ISSUER: option(args, 'oidc-issuer'),
    DATABASE_HOST: option(args, 'database-host'),
    DATABASE_NAME: option(args, 'database-name'),
    DATABASE_PORT: option(args, 'database-port'),
  }
  if (!['render', 'validate', 'diff', 'apply', 'status', 'logs', 'down'].includes(action))
    throw new Error(`Unknown k8s action: ${action}`)
  if (action !== 'logs') noExtra(args)
  // The settings of the deployment live in one file: when there is none, the first run asks
  // for what it does not know and writes it down, so that the flags are optional afterwards.
  if (['render', 'validate', 'diff', 'apply'].includes(action))
    await ensureConfig(
      'k8s',
      {
        PLATFORM_DOMAIN: given.PLATFORM_DOMAIN ?? r.env.PLATFORM_DOMAIN,
        PLATFORM_IDP_HOST: r.env.PLATFORM_IDP_HOST,
        PLATFORM_API_HOST: r.env.PLATFORM_API_HOST,
        PLATFORM_DB_HOST: r.env.PLATFORM_DB_HOST,
        PLATFORM_IMAGE: given.PLATFORM_IMAGE ?? r.env.PLATFORM_IMAGE,
        PUBLIC_URL: given.PUBLIC_URL ?? r.env.PUBLIC_URL,
        DATABASE_PORT: given.DATABASE_PORT ?? r.env.DATABASE_PORT,
      },
      r
    )
  // The addresses the deployment is named by, worked out from the pieces it is made of.
  const computed = computedValues('k8s', r)
  // The domain the deployment is named by: each service answers on its own sub-domain of it.
  const domain = given.PLATFORM_DOMAIN ?? settingValue(r, 'PLATFORM_DOMAIN') ?? ''
  const idpHost = settingValue(r, 'PLATFORM_IDP_HOST') ?? 'idp'
  const apiHost = settingValue(r, 'PLATFORM_API_HOST') ?? 'api'
  const dbHost = settingValue(r, 'PLATFORM_DB_HOST') ?? 'db'
  const image = given.PLATFORM_IMAGE ?? settingValue(r, 'PLATFORM_IMAGE') ?? ''
  // The site's address: the one the operator gave, or the one the site is deployed on.
  const publicUrl =
    given.PUBLIC_URL ?? settingValue(r, 'PUBLIC_URL') ?? computed.PLATFORM_SITE_URL ?? ''
  const oidcIssuer = given.OIDC_ISSUER ?? computed.OIDC_ISSUER ?? ''
  const relayUrl = computed.PLATFORM_RELAY_URL ?? ''
  const databasePort = given.DATABASE_PORT ?? settingValue(r, 'DATABASE_PORT') ?? '5432'
  const databaseHost = given.DATABASE_HOST ?? computed.DATABASE_HOST ?? ''
  const databaseName = given.DATABASE_NAME ?? computed.DATABASE_NAME ?? 'platform'
  // The domain names the deployment: the actions that render manifests need it, and the
  // ones that only look at a cluster do not.
  if (!domain && !publicUrl && ['render', 'validate', 'diff', 'apply'].includes(action))
    throw new Error(
      `--domain or PLATFORM_DOMAIN is required: the deployment is named by it, and each service answers on its own sub-domain of it (${idpHost}, ${apiHost}, ${dbHost})`
    )
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
  const rolled = await run([
    'rollout',
    'status',
    'deployment/platform-relay',
    `--timeout=${timeout}s`,
  ])
  if (rolled) return rolled
  // The relay answers on the sub-domain of the API: the ingress is what serves it.
  r.print(
    `The relay is deployed, on ${relayUrl}. The pages reach PostgreSQL through it, and sign
in through the issuer at ${oidcIssuer}. Put the relay behind that address: deploy/k8s/ingress.yaml
is an example of an ingress that serves it, with the certificate for the name.`
  )
  return 0
}
