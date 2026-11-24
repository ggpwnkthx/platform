/** What the pages need to find the issuer and the database: `config.json`, served beside them. */
export interface RuntimeConfig {
  issuer: string
  clientId: string
  claim: string
  relay: string
  database: string
  statementTimeoutMs: number
}
export const defaultRuntimeConfig: RuntimeConfig = {
  issuer: 'http://idp.localhost:5556',
  clientId: 'platform-console',
  claim: 'email',
  relay: '/pg',
  database: 'platform',
  statementTimeoutMs: 15000,
}
/** The deployment's answer: the platform's defaults, then the environment it is built in. */
export const runtimeConfigFrom = (env: Record<string, string | undefined>): RuntimeConfig => ({
  issuer: (env.PLATFORM_ISSUER ?? defaultRuntimeConfig.issuer).replace(/\/+$/, ''),
  clientId: env.PLATFORM_CLIENT_ID ?? defaultRuntimeConfig.clientId,
  claim: env.PLATFORM_CLAIM ?? defaultRuntimeConfig.claim,
  relay: env.PLATFORM_RELAY_URL ?? defaultRuntimeConfig.relay,
  database: env.PLATFORM_DATABASE_NAME ?? defaultRuntimeConfig.database,
  statementTimeoutMs: Number(
    env.PLATFORM_STATEMENT_TIMEOUT_MS ?? defaultRuntimeConfig.statementTimeoutMs
  ),
})

/** The configuration the page was published with, with the relay as a WebSocket address. */
export async function loadConfig(): Promise<RuntimeConfig> {
  const response = await fetch('/config.json', { cache: 'no-store' })
  if (!response.ok) throw new Error('The interface has no configuration: config.json is missing.')
  const config = { ...defaultRuntimeConfig, ...(await response.json()) } as RuntimeConfig
  const relay = new URL(config.relay, location.href)
  if (!/^wss?:$/.test(relay.protocol))
    relay.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return { ...config, issuer: config.issuer.replace(/\/+$/, ''), relay: relay.toString() }
}

/** The headers a CDN serves the site with: the pages reach the issuer and the relay, nothing else. */
export function headersFile(config: RuntimeConfig, inPage = false): string {
  const origin = (url: string) => {
    try {
      return new URL(url).origin.replace(/^http/, url.startsWith('ws') ? 'ws' : 'http')
    } catch {
      return ''
    }
  }
  const headers = {
    'Content-Security-Policy': [
      "default-src 'self'",
      // The in-page PostgreSQL of the dev mode is WebAssembly; the published interface has none.
      `script-src 'self'${inPage ? " 'wasm-unsafe-eval'" : ''}`,
      // The component library writes its styles into the document as it draws.
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self'",
      `connect-src 'self' ${origin(config.issuer)} ${origin(config.relay)}`.trim(),
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  }
  return `/*\n${Object.entries(headers)
    .map(([name, value]) => `  ${name}: ${value}`)
    .join('\n')}\n`
}
