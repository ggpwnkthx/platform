/**
 * The composition of the console.
 *
 * The one place where the concrete pieces are assembled: the clients of
 * the three services, the stores of the sessions and the configuration
 * they share. The pages ask for the services, and they never build a
 * client of their own.
 *
 * The server of the development reloads the modules of the pages when
 * they change. The stores of the sessions and of the logins are kept on
 * the global object, so that the sessions of the developer survive a
 * reload; the clients are composed again with the modules that changed,
 * so that a page never meets a class of a module that was replaced.
 */

import { AccessError, AdminClient, ContextClient } from '../domains/access'
import { AccessProvider } from '../domains/authentication'
import { DataClient } from '../domains/data'
import type { AdminCredentials } from '../domains/operators'
import { LoginStore, SessionStore } from '../domains/session'
import { probeService, type ServiceStatus } from '../domains/status'
import { type ConsoleConfig, readConfig } from './config'
import { createLogger, type Logger } from './log'
import { VERSION } from './version'

/** The services of the console. */
export interface Services {
  readonly config: ConsoleConfig
  readonly log: Logger
  readonly sessions: SessionStore
  readonly logins: LoginStore
  readonly provider: AccessProvider
  /** The client of the access context, or null when the console holds no credential of it. */
  readonly context: ContextClient | null
  readonly credentials: AdminCredentials
  /** The client of the administration, with a credential. */
  admin: (credential: string) => AdminClient
  /** The client of the data of a workspace, for a caller. */
  data: (workspaceId: string, token: string) => DataClient
  /** The status of the services of the platform. */
  probes: () => Promise<ServiceStatus[]>
  /** The identifier of a tenant, from its slug. */
  tenantId: (slug: string) => Promise<string | null>
  /** The url the browser comes back to after a login. */
  readonly callbackUrl: string
}

const STORES = Symbol.for('platform.console.stores')

/** The stores that survive a reload of the modules. */
interface Stores {
  readonly sessions: SessionStore
  readonly logins: LoginStore
}

/** Builds the services of the console from a configuration. */
export function compose(config: ConsoleConfig, stores?: Stores): Services {
  const log = createLogger(config.logLevel)
  const credentials: AdminCredentials = {
    platform: config.adminToken,
    tenants: config.tenantAdminTokens,
  }
  const tenantIds = new Map<string, { id: string | null; at: number }>()
  const admin = (credential: string): AdminClient =>
    new AdminClient({
      accessUrl: config.accessUrl,
      credential,
      timeoutMs: config.requestTimeoutMs,
    })

  return {
    config,
    log,
    sessions:
      stores?.sessions ??
      new SessionStore({ ttlMs: config.sessionTtlMs, maxAgeMs: config.sessionMaxAgeMs }),
    logins: stores?.logins ?? new LoginStore(),
    provider: new AccessProvider({
      accessUrl: config.accessUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      timeoutMs: config.requestTimeoutMs,
    }),
    context: config.accessContextToken
      ? new ContextClient({
          accessUrl: config.accessUrl,
          credential: config.accessContextToken,
          timeoutMs: config.requestTimeoutMs,
        })
      : null,
    credentials,
    admin,
    data: (workspaceId, token) =>
      new DataClient({
        gatewayUrl: config.gatewayUrl,
        workspaceId,
        token,
        timeoutMs: config.requestTimeoutMs,
      }),
    probes: async () => {
      const itself: ServiceStatus = {
        id: 'console',
        name: 'The console',
        state: 'up',
        version: VERSION,
        health: null,
        ready: null,
        checkedAt: new Date().toISOString(),
      }
      const others = await Promise.all(
        [
          { id: 'gateway' as const, name: 'The gateway', url: config.gatewayUrl },
          { id: 'access' as const, name: 'The access service', url: config.accessUrl },
          { id: 'data' as const, name: 'The data service', url: config.dataUrl },
        ].map((target) => probeService(target, { timeoutMs: config.probeTimeoutMs }))
      )
      return [...others, itself]
    },
    tenantId: async (slug) => {
      const cached = tenantIds.get(slug)
      if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.id
      // The identifier of a tenant is read with the credential that may
      // read it: the one of the tenant, or the one of the platform.
      const credential = credentials.tenants[slug] ?? credentials.platform
      if (!credential) return null
      try {
        const tenants = await admin(credential).tenants()
        const id = tenants.find((tenant) => tenant.slug === slug)?.id ?? null
        tenantIds.set(slug, { id, at: Date.now() })
        return id
      } catch (error) {
        if (error instanceof AccessError) {
          log.warn('the identifier of the tenant could not be read', {
            tenant: slug,
            status: error.status,
            code: error.code,
          })
          return null
        }
        throw error
      }
    },
    callbackUrl: new URL('/auth/callback', config.publicUrl).toString(),
  }
}

let composed: Services | undefined

/** The services of the console, composed once from the environment of the process. */
export function services(): Services {
  if (composed) return composed
  const holder = globalThis as typeof globalThis & { [STORES]?: Stores }
  composed = compose(readConfig(process.env), holder[STORES])
  holder[STORES] = { sessions: composed.sessions, logins: composed.logins }
  return composed
}
