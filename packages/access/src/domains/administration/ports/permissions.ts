/**
 * The port of the permissions.
 *
 * The domain owns the rules of the twelve endpoints; the storage is a port
 * that the composition root fulfils. The domain knows nothing about
 * PostgreSQL and nothing about the shape of the rows.
 */

/** A permission of the platform. */
export interface Permission {
  id: string
  /** The tenant that owns the permission, or null for the catalogue. */
  tenantId: string | null
  key: string
  description: string | null
  enabled: boolean
}

/** The storage of the permissions. */
export interface PermissionStore {
  /** The permission of the catalogue of the platform. */
  findCataloguePermission(key: string): Promise<Permission | null>
  /** The permission of a tenant. */
  findByTenantAndKey(tenantId: string, key: string): Promise<Permission | null>
  /** The permission of a key, whatever the tenant that owns it. */
  findByKey(key: string): Promise<Permission | null>
  /** Creates a permission. */
  create(registration: { tenantId: string | null; key: string }): Promise<Permission>
  /**
   * Creates a permission, or reads the one that is already there.
   *
   * A key is a name inside a tenant: two tenants may hold a permission
   * of the same key, and two calls of the same tenant may create it at
   * the same time.
   */
  createOrFind(registration: { tenantId: string | null; key: string }): Promise<Permission>
}
