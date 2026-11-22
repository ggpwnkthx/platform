import { defaultRuntimeConfig, type RuntimeConfig } from '@platform/ui/config.ts'
import type { Origins } from '@platform/ui/headers.ts'

/**
 * The file the pages read to find the issuer, the relay and the database. It is served
 * beside the pages, so a deployment changes it without rebuilding the bundle.
 *
 * Two say it, in this order: the platform's own defaults, and the environment the deployment
 * runs in. A folder says what it is, and never where it runs, so it is not asked.
 */
export function siteConfig(
  relay: string | undefined,
  env: Record<string, string | undefined> = process.env
): RuntimeConfig {
  const base = defaultRuntimeConfig
  return {
    issuer: env.PLATFORM_ISSUER ?? env.OIDC_ISSUER ?? base.issuer,
    clientId: env.PLATFORM_CLIENT_ID ?? base.clientId,
    claim: env.PLATFORM_CLAIM ?? base.claim,
    relay: relay ?? base.relay,
    database: env.PLATFORM_DATABASE_NAME ?? base.database,
    statementTimeoutMs: Number(env.PLATFORM_STATEMENT_TIMEOUT_MS ?? base.statementTimeoutMs),
  }
}

/**
 * The deployment's names, as the headers need them: who the pages may speak to. The issuer
 * is the one `config.json` sends the pages to, so the two files cannot say different things.
 */
export function siteOrigins(
  config: RuntimeConfig,
  env: Record<string, string | undefined> = process.env
): Origins {
  return {
    public: env.PLATFORM_PUBLIC_URL ?? 'http://localhost:5173',
    issuer: config.issuer,
    relay: env.PLATFORM_RELAY_URL ?? 'ws://localhost:8081',
  }
}
