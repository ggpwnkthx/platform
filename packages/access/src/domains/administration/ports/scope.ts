/**
 * The scope of a statement of the storage (spec §3.10).
 *
 * The scope says which rows of the platform a statement may touch: the
 * rows of one tenant, or every row of the platform.
 *
 * The scope is the scope of the **credential of the call**: a
 * credential of a tenant may only act for that tenant, and the
 * statements it causes are confined to that tenant by the database
 * itself, and not only by the rules of the domain. The scope of the
 * platform is the scope of the operator of the platform and of the
 * registry of the tenants, and it is asked for by name.
 *
 * The scope of a statement is never the default: a statement that was
 * not given a scope sees nothing (spec §3.10).
 */

/** The scope of a statement of the storage. */
export type Scope =
  /** The scope of a tenant: the rows of that tenant and nothing else. */
  | { readonly tenant: string }
  /** The scope of the platform: every row of the platform. */
  | { readonly platform: true }

/** The scope of the platform: every row of the platform. */
export function platformScope(): Scope {
  return { platform: true }
}

/** The scope of a tenant: the rows of that tenant and nothing else. */
export function tenantScope(tenantId: string): Scope {
  return { tenant: tenantId }
}

/**
 * The scope of a tenant, or the scope of the platform.
 *
 * A null is the scope of the platform: it is the scope of the calls of
 * the operator of the platform.
 */
export function scopeOf(tenantId: string | null): Scope {
  return tenantId === null ? platformScope() : tenantScope(tenantId)
}
