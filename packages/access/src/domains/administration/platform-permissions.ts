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
 * credential of the platform makes a principal hold one, in whichever
 * way it comes to hold it — a grant of the capability, a grant of a role
 * that holds it, a role that is written to hold it, and a group that
 * holds it and takes a new member (spec §3.3.1).
 */

import type { AdminScope } from './credentials'
import { AdministrationError } from './errors'
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

/**
 * The capability of the platform among the keys, or null when none of
 * them is one.
 *
 * @param options what the administration is built with.
 * @param keys the keys of the permissions a call gives.
 */
export function platformPermissionAmong(
  options: AdministrationOptions,
  keys: readonly string[]
): string | null {
  return keys.find((key) => isPlatformPermission(options, key)) ?? null
}

/** What the refusal says: an operator with a `curl` reads it, and so does a script. */
const REFUSAL = 'the credential of a tenant may not give a capability of the platform'

/**
 * Refuses the credential of a tenant that gives a capability of the
 * platform (spec §3.3.1).
 *
 * The credential of the platform gives every capability, and a call
 * that gives none is the business of the credential that makes it.
 *
 * @param scope the scope of the call.
 * @param capability the capability the call gives, or null when it
 *   gives none.
 * @param holder what holds the capability when the call does not name
 *   it itself — the role that is granted, the role that is named, the
 *   group that takes a member — as the refusal says it.
 */
export function refuseTenantGift(
  scope: AdminScope,
  capability: string | null,
  holder?: string
): void {
  if (capability === null || scope.tenant === null) return
  throw new AdministrationError(
    'forbidden',
    holder ? `${REFUSAL}: ${holder} holds "${capability}"` : REFUSAL
  )
}
