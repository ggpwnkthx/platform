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
/** The deployment's answer: the platform's defaults, then the environment it runs in. */
export const runtimeConfigFrom = (
  env: Record<string, string | undefined>,
  relay?: string
): RuntimeConfig => ({
  issuer: (env.PLATFORM_ISSUER ?? env.OIDC_ISSUER ?? defaultRuntimeConfig.issuer).replace(
    /\/+$/,
    ''
  ),
  clientId: env.PLATFORM_CLIENT_ID ?? defaultRuntimeConfig.clientId,
  claim: env.PLATFORM_CLAIM ?? defaultRuntimeConfig.claim,
  relay: relay ?? env.PLATFORM_RELAY_URL ?? defaultRuntimeConfig.relay,
  database: env.PLATFORM_DATABASE_NAME ?? defaultRuntimeConfig.database,
  statementTimeoutMs: Number(
    env.PLATFORM_STATEMENT_TIMEOUT_MS ?? defaultRuntimeConfig.statementTimeoutMs
  ),
})

/** The pages of the interface. Each is written out as its own file, so a reload lands on one. */
export const pages = {
  '/': 'Sign in',
  '/data': 'Data',
  '/data/records': 'Records',
  '/data/item': 'Record',
  '/data/model': 'Data model',
  '/data/model/collection': 'Collection',
  '/data/model/new': 'New collection',
  // The paths the interface had before the data module: a bookmark of one still lands on a page.
  '/content': 'Data',
  '/content/records': 'Records',
  '/content/item': 'Record',
  '/model': 'Data model',
  '/model/collection': 'Collection',
  '/model/new': 'New collection',
  '/workspace/new': 'New workspace',
  '/workspace/settings': 'Workspace settings',
  '/access': 'Users and groups',
  '/access/role': 'Role',
  // The access pages that gave way: a workspace keeps its own permissions, and a collection
  // its own policies. A bookmark of either still lands on a page.
  '/access/grants': 'Workspace permissions',
  '/access/policies': 'Data model',
  '/activity': 'Activity',
  '/sql': 'SQL',
} as const

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
      // The component library styles elements inline.
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data:",
      `connect-src 'self' ${origin(config.issuer)} ${origin(config.relay)}`.trim(),
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
