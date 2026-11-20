/**
 * What the page needs to find the issuer and the database. The pages are static, so this is
 * a file served beside them (/config.json): a deployment changes it without rebuilding.
 */
export interface RuntimeConfig {
  /** The one OpenID Connect issuer PostgreSQL trusts: Dex. */
  issuer: string
  /** The public client the page signs in with. */
  clientId: string
  /** The token claim PostgreSQL matches against the role name. */
  claim: string
  /** The WebSocket address of the relay in front of PostgreSQL. Relative to the page if it starts with /. */
  relay: string
  /** The database Platform is installed in. */
  database: string
  statementTimeoutMs: number
}

/**
 * The platform's own defaults: what a site says when it says nothing. A deployment names
 * its own issuer, relay and database, and the builder starts from these.
 */
export const defaultRuntimeConfig: RuntimeConfig = {
  issuer: 'http://idp.localhost:5556',
  clientId: 'platform-console',
  claim: 'email',
  relay: '/pg',
  database: 'platform',
  statementTimeoutMs: 15000,
}

let loaded: Promise<RuntimeConfig> | null = null

/** The relay's absolute address: a path is resolved against the page, ws for http, wss for https. */
export function relayUrl(relay: string, page: URL): string {
  if (/^wss?:\/\//.test(relay)) return relay
  const url = new URL(relay, page)
  url.protocol = page.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export function runtimeConfig(): Promise<RuntimeConfig> {
  loaded ??= fetch('/config.json', { cache: 'no-store' })
    .then((response) => {
      // A site without its configuration cannot work, and saying so is better than sending
      // the reader to a relay that is not there.
      if (!response.ok)
        throw new Error('The interface has no configuration: config.json is missing from the site.')
      return response.json()
    })
    .then((found: Partial<RuntimeConfig>) => {
      const config = { ...defaultRuntimeConfig, ...found }
      config.issuer = config.issuer.replace(/\/+$/, '')
      config.relay = relayUrl(config.relay, new URL(location.href))
      return config
    })
  return loaded
}
