import { basename } from 'node:path'
import { type DeployRuntime, runtime } from '../runtime.ts'
import { settingValue, siteFolder } from '../config.ts'
import type { FolderConfig } from '../../config.ts'

/**
 * The one account the local stack's Dex keeps with a password: the break-glass
 * administrator, the person who installs the database and gets in when nothing else does.
 * Everybody else signs in through a connector, an identity provider that vouches for the
 * addresses it returns.
 */
export const LOCAL_ADMIN = {
  DEX_ADMIN_HASH: 'PLATFORM_ADMIN_PASSWORD',
}
/** A setting of the deployment: from the environment, or from the saved file. */
function settingOf(r: DeployRuntime, name: string, fallback: string): string {
  return settingValue(r, name) ?? fallback
}
/**
 * The site's address: the one the operator gave, or the one the site is deployed on.
 * It is worked out from the pieces the configuration holds.
 */
export function siteAddress(r: DeployRuntime, computed: Record<string, string>): string {
  return (
    settingValue(r, 'PLATFORM_PUBLIC_URL') ??
    settingValue(r, 'PUBLIC_URL') ??
    computed.PLATFORM_SITE_URL ??
    'http://localhost:5173'
  )
}
/**
 * The folder of the site the deployment chose, as the configuration names it: from the root
 * of the checkout, or in full. A configuration written when a site could only be one of the
 * checkout's examples is told what to say now, and is not guessed at.
 */
export function chosenSite(r: DeployRuntime): string {
  const site = settingValue(r, 'PLATFORM_SITE') ?? ''
  const before = settingValue(r, 'PLATFORM_EXAMPLE')
  if (!site && before)
    throw new Error(
      `PLATFORM_EXAMPLE=${before} is PLATFORM_SITE=examples/${before} now: a deployment names the folder of its site, which may be any folder that holds platform.json. Change the line in ${r.envFile}.`
    )
  return site
}
/** Where the local stack publishes PostgreSQL, for commands that sign in to it with a token. */
export function localDatabase(r: DeployRuntime = runtime) {
  const domain = settingOf(r, 'PLATFORM_DOMAIN', 'localhost')
  return {
    host: `${settingOf(r, 'PLATFORM_DB_HOST', 'db')}.${domain}`,
    port: settingOf(r, 'POSTGRES_PORT', '5432'),
    name: 'platform',
  }
}
/** The settings of the local stack: the names it is called by, the ports it answers on. */
export type StackSettings = {
  domain: string
  idpHost: string
  apiHost: string
  dbHost: string
  appHost: string
  dexPort: string
  relayPort: string
  postgresPort: string
  edgePort: string
  edgeTlsPort: string
  admin: string
  /** The name of the issuer, of the relay and of the database: what the services answer for. */
  idp: string
  api: string
  db: string
  app: string
  /** The folder of the site the deployment chose, when it chose one. */
  folder: FolderConfig | null
  /** What the site is called in what is said of it: its folder's own name. */
  siteName: string
  /** The site itself, as the configuration names it: empty when the site is elsewhere. */
  site: string
}

/**
 * The settings of the local stack, read once and in the order they are asked for: the ports
 * the services answer on, the names the deployment is called by, and the site it serves, if
 * it chose one. A setting that cannot be right is refused here, before anything is run.
 */
export function stackSettings(r: DeployRuntime, domainOption: string | undefined): StackSettings {
  const setting = (name: string, fallback: string) => {
    const value = settingOf(r, name, fallback)
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
      throw new Error(`Invalid ${name}`)
    return value
  }
  const text = (name: string, fallback: string) => settingOf(r, name, fallback)
  const dexPort = setting('DEX_PORT', '5556')
  const relayPort = setting('RELAY_PORT', '8081')
  const postgresPort = setting('POSTGRES_PORT', '5432')
  // The names of the deployment: each service answers on its own sub-domain of the domain.
  const domain = domainOption ?? text('PLATFORM_DOMAIN', 'localhost')
  const idpHost = text('PLATFORM_IDP_HOST', 'idp')
  const apiHost = text('PLATFORM_API_HOST', 'api')
  const dbHost = text('PLATFORM_DB_HOST', 'db')
  // The edge answers on a port of this machine's choosing, never on 80 or 443: a rootless
  // container cannot bind those, and the operator's machine is not the deployment's business.
  const edgePort = setting('EDGE_PORT', '8080')
  const edgeTlsPort = setting('EDGE_TLS_PORT', '4433')
  // The site the deployment chose, if it chose one: the folder that holds its
  // platform.json, any folder at all. It is built here and served by the stack itself, on a
  // name of its own. A site that already exists elsewhere is not the stack's business.
  const own = settingValue(r, 'PLATFORM_PUBLIC_URL') ?? settingValue(r, 'PUBLIC_URL')
  const site = own ? '' : chosenSite(r)
  const folder = site ? siteFolder(site) : null
  const siteName = folder ? basename(folder.dir) : ''
  const appHost = text('PLATFORM_APP_HOST', 'app')
  // The one account the stack's Dex keeps, and the role the installer makes for it: the
  // deployment's own administrator, on its own domain unless another is named.
  const admin = text('PLATFORM_ADMIN', `admin@${domain}`)
  if (!/^[^\s"'\\,@]+@[^\s"'\\,@]+$/.test(admin) || admin.length > 63)
    throw new Error('Invalid PLATFORM_ADMIN')
  return {
    domain,
    idpHost,
    apiHost,
    dbHost,
    appHost,
    dexPort,
    relayPort,
    postgresPort,
    edgePort,
    edgeTlsPort,
    admin,
    idp: `${idpHost}.${domain}`,
    api: `${apiHost}.${domain}`,
    db: `${dbHost}.${domain}`,
    app: `${appHost}.${domain}`,
    folder,
    siteName,
    site,
  }
}
