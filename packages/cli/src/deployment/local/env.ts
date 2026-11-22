import { join } from 'node:path'
import { type DeployRuntime, ROOT, generate, saved } from '../runtime.ts'
import { LOCAL_ADMIN, type StackSettings } from './settings.ts'
import { siteAddress } from './settings.ts'

/**
 * The environment the stack's own commands run in: the settings of the machine, and the names
 * the deployment is called by. PostgreSQL is given no password, and neither is anything else:
 * the only value generated is the break-glass administrator's, which Dex asks for in place of
 * a real sign-in system. It is generated only once the options are valid and a Compose tool
 * is found.
 */
export async function stackEnv(
  r: DeployRuntime,
  computed: Record<string, string>,
  s: StackSettings,
  /** Whether the run prepares the stack: only then is the administrator's hash written. */
  prepares: boolean
): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = {
    ...r.env,
    // Podman says which Compose provider it runs, every time it runs one: once is enough.
    PODMAN_COMPOSE_WARNING_LOGS: 'false',
    DEX_PORT: s.dexPort,
    RELAY_PORT: s.relayPort,
    // The names the Compose file builds the addresses of the services from.
    PLATFORM_DOMAIN: s.domain,
    PLATFORM_IDP_HOST: s.idpHost,
    PLATFORM_API_HOST: s.apiHost,
    PLATFORM_DB_HOST: s.dbHost,
    // The ports the edge answers on, on this machine.
    EDGE_PORT: s.edgePort,
    EDGE_TLS_PORT: s.edgeTlsPort,
    // The only origin the relay allows: the address the site is served from.
    PLATFORM_PUBLIC_ORIGIN: siteAddress(r, computed),
    // The site: the edge routes its name only when there is one, the installer reads what
    // its folder applies, and the files it is served from are the ones built on this machine.
    PLATFORM_SITE: s.site,
    PLATFORM_SITE_FOLDER: s.folder?.dir ?? join(ROOT, 'examples'),
    // The administrator: the account Dex keeps, and the role the installer makes for it.
    PLATFORM_ADMIN: s.admin,
    PLATFORM_APP_HOST: s.appHost,
    PLATFORM_SITE_DIST: s.folder ? join(s.folder.dir, '.dist') : join(ROOT, 'packages/ui/dist'),
  }
  // Dex is given only hashes. The password stays in the saved file for the operator to read.
  if (prepares)
    for (const [hash, name] of Object.entries(LOCAL_ADMIN))
      env[hash] = await r.hash(r.env[name] || saved(r.envFile, name) || generate(name, r))
  return env
}
