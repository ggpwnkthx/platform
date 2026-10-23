/**
 * The types of the HTTP boundary (spec §9).
 *
 * The module holds the environment of the application, the variables
 * that a request carries and the dependencies that the application
 * uses. The routes and the application itself share them.
 */

import type { AuditReader } from '../domains/audit'
import type { RequestContext, ResolvedContext } from '../domains/authorization'
import type { CatalogProvider } from '../domains/catalog'
import type { ModelService } from '../domains/model'
import type { ResolvedBinding, VerifiedGatewayIdentity } from '../domains/gateway-context'
import type { RecordsService } from '../domains/records'
import type { WorkspaceIdentity } from '../domains/workspaces'
import type { Logger } from '../observability/logger'
import type { Metrics } from '../observability/metrics'
import type { Clock } from '../protocol/clock'
import type { TenantLimiter } from '../runtime/limits'

/** The environment of the application: the variables of the request. */
export type AppEnv = { Variables: AppVariables }

/** The variables of the context of a request. */
export interface AppVariables {
  requestId: string
  context?: RequestContext
  gateway?: VerifiedGatewayIdentity
  workspace?: WorkspaceIdentity
}

/** The dependencies of the application. */
export interface AppDependencies {
  readonly settings: {
    readonly production: boolean
    readonly requests: { maxBodyBytes: number; timeoutMs: number }
    readonly observability: { metricsToken?: string }
  }
  readonly records: RecordsService
  readonly resolver: ContextResolverLike
  readonly bindings: readonly ResolvedBinding[]
  /** The catalog of the workspace: its collections and its policies. */
  readonly catalog: CatalogProvider
  /** The model of the workspace: the logical shape of its collections. */
  readonly model: ModelService
  readonly auditReader: AuditReader
  readonly metrics: Metrics
  readonly logger: Logger
  readonly clock: Clock
  readonly readiness: ReadinessLike
  /**
   * The bound of a tenant.
   *
   * It is applied once the tenant of the request is known, and it
   * answers `429 TOO_MANY_REQUESTS` to a tenant that holds its whole
   * room.
   */
  readonly limiter: TenantLimiter
  /** The version of the service, as the release that built it. */
  readonly serviceVersion: string
  /** The version of the manifest of the deployment. */
  readonly schemaVersion: string
}

/** The resolver of the context, as the application uses it. */
export interface ContextResolverLike {
  resolve: (
    request: {
      subject: string
      tenantId: string
      workspaceId: string
      routeId: string
    },
    options: {
      fresh: boolean
      source: 'gateway' | 'worker'
      requestId: string
      policyBundleVersion?: string
    }
  ) => Promise<ResolvedContext>
}

/** The readiness of the process, as the application uses it. */
export interface ReadinessLike {
  check: () => Promise<{ ready: boolean; reason?: string }>
}
