/**
 * The capabilities that are not relative to a tenant.
 *
 * A permission of the catalogue of the platform names a capability of
 * the platform and not of one tenant: `console.platform` opens the
 * administration of every tenant, and it means the same thing in every
 * one of them (spec §3.3).
 *
 * The deployment names the keys it holds to be platform-wide. The
 * default is the one of the console, and a deployment that names
 * another key takes on the responsibility of it.
 *
 * A capability of the platform is given by the platform: only a
 * credential of the platform may grant it (spec §10.6).
 */

import type { AdministrationOptions } from './options'

/**
 * The keys of the capabilities that are not relative to a tenant.
 *
 * The key is the one of the console: the console reads it in the
 * context of its caller and opens the administration of every tenant
 * with it (spec §6.4 of the console).
 */
export const PLATFORM_PERMISSIONS: readonly string[] = ['console.platform']

/**
 * Reports whether a key names a capability that is not relative to a
 * tenant.
 *
 * @param options what the administration is built with.
 * @param key the key of the permission.
 */
export function isPlatformPermission(options: AdministrationOptions, key: string): boolean {
  return (options.platformPermissions ?? PLATFORM_PERMISSIONS).includes(key)
}
