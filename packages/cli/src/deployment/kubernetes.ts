import { type DeployRuntime, noExtra, option, seconds } from './runtime.ts'
import { computedValues, ensureConfig, settingValue } from './config.ts'
import { firstGiven, renderKubernetes } from './manifests.ts'

/** The actions that name the deployment itself: they render manifests and need its names. */
const MANIFEST_ACTIONS = ['render', 'validate', 'diff', 'apply']

/**
 * The settings of a Kubernetes deployment: what the operator gave on the command line, what
 * is saved, and the addresses the deployment is named by.
 */
async function k8sSettings(
  action: string,
  args: string[],
  r: DeployRuntime
): Promise<{
  namespace: string
  timeout: number
  domain: string
  idpHost: string
  apiHost: string
  dbHost: string
  image: string
  publicUrl: string
  oidcIssuer: string
  relayUrl: string
  databasePort: string
  databaseHost: string
  databaseName: string
}> {
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
  if (MANIFEST_ACTIONS.includes(action))
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
  const domain = firstGiven(given.PLATFORM_DOMAIN, settingValue(r, 'PLATFORM_DOMAIN'))
  const idpHost = firstGiven(settingValue(r, 'PLATFORM_IDP_HOST'), 'idp')
  const apiHost = firstGiven(settingValue(r, 'PLATFORM_API_HOST'), 'api')
  const dbHost = firstGiven(settingValue(r, 'PLATFORM_DB_HOST'), 'db')
  const image = firstGiven(given.PLATFORM_IMAGE, settingValue(r, 'PLATFORM_IMAGE'))
  // The site's address: the one the operator gave, or the one the site is deployed on.
  const publicUrl = firstGiven(
    given.PUBLIC_URL,
    settingValue(r, 'PUBLIC_URL'),
    computed.PLATFORM_SITE_URL
  )
  const oidcIssuer = firstGiven(given.OIDC_ISSUER, computed.OIDC_ISSUER)
  const relayUrl = firstGiven(computed.PLATFORM_RELAY_URL)
  const databasePort = firstGiven(given.DATABASE_PORT, settingValue(r, 'DATABASE_PORT'), '5432')
  const databaseHost = firstGiven(given.DATABASE_HOST, computed.DATABASE_HOST)
  const databaseName = firstGiven(given.DATABASE_NAME, computed.DATABASE_NAME, 'platform')
  return {
    namespace,
    timeout,
    domain,
    idpHost,
    apiHost,
    dbHost,
    image,
    publicUrl,
    oidcIssuer,
    relayUrl,
    databasePort,
    databaseHost,
    databaseName,
  }
}

export async function kubernetes(
  action: string,
  args: string[],
  r: DeployRuntime
): Promise<number> {
  const s = await k8sSettings(action, args, r)
  // The domain names the deployment: the actions that render manifests need it, and the
  // ones that only look at a cluster do not.
  if (!s.domain && !s.publicUrl && MANIFEST_ACTIONS.includes(action))
    throw new Error(
      `--domain or PLATFORM_DOMAIN is required: the deployment is named by it, and each service answers on its own sub-domain of it (${s.idpHost}, ${s.apiHost}, ${s.dbHost})`
    )
  const manifest = MANIFEST_ACTIONS.includes(action)
    ? renderKubernetes({
        image: s.image,
        publicUrl: s.publicUrl,
        oidcIssuer: s.oidcIssuer,
        databaseHost: s.databaseHost,
        databaseName: s.databaseName,
        databasePort: s.databasePort,
        namespace: s.namespace,
      })
    : ''
  if (action === 'render') {
    r.print(manifest)
    return 0
  }
  const k = r.which('kubectl')
  if (!k) throw new Error('kubectl is not installed or not on PATH')
  const run = (a: string[], input?: string) => r.run([k, '-n', s.namespace, ...a], { input })
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
    `--timeout=${s.timeout}s`,
  ])
  if (rolled) return rolled
  // The relay answers on the sub-domain of the API: the ingress is what serves it.
  r.print(
    `The relay is deployed, on ${s.relayUrl}. The pages reach PostgreSQL through it, and sign
in through the issuer at ${s.oidcIssuer}. Put the relay behind that address: deploy/k8s/ingress.yaml
is an example of an ingress that serves it, with the certificate for the name.`
  )
  return 0
}
