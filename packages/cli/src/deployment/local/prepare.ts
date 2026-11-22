import { type DeployRuntime, noExtra } from '../runtime.ts'
import { computedValues, ensureConfig } from '../config.ts'
import { buildInterface } from './site.ts'

/**
 * What the run needs before anything is started: the action is one the stack knows, the
 * options are the ones it takes, and the settings of the stack live in one file: when there
 * is none, the first run asks for what it does not know and writes it down, with the secrets
 * it generates in it. The addresses the deployment is named by are worked out from the pieces
 * it is made of, and the interface, which is a static site, is built and left: it needs no
 * container, only the toolchain.
 */
export async function prepareStack(
  action: string,
  args: string[],
  r: DeployRuntime,
  domainOption: string | undefined
): Promise<{ computed: Record<string, string>; built: number | undefined }> {
  if (
    !['up', 'init', 'ui', 'validate', 'build', 'status', 'logs', 'down', 'admin'].includes(action)
  )
    throw new Error(`Unknown local action: ${action}`)
  if (!['logs', 'down', 'admin'].includes(action)) noExtra(args)
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
  const computed = computedValues('local', r)
  if (action === 'ui') return { computed, built: await buildInterface(r, computed) }
  return { computed, built: undefined }
}
