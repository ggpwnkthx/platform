/**
 * The permissions of a tenant, described once.
 *
 * A permission reaches a tenant three ways: the console and Data fix a
 * few keys in their code, the policies of the deployment name the
 * capabilities of the records, and an operator writes a key of its own
 * in a role or a right. Every page that shows a permission, and every
 * form that chooses one, reads the same entry: the key, what it opens in
 * a sentence, where a right has to hold to open it, and the roles that
 * hold it.
 *
 * The entry is an explanation and never a decision: Access decides with
 * the rights, and Data with its policies.
 */

import type { Grant, Role } from '../access'
import {
  type DeploymentCapability,
  familyOf,
  knownPermission,
  opensOf,
  type Reach,
} from './catalog'
import { knownPermissionsOf, permissionsOfGrant, permissionsOfRole } from './effective'
import { isPlatformKey } from './scope'

/**
 * Who describes a permission.
 *
 * | Source | The key is |
 * | --- | --- |
 * | `console` | Read by the console, and fixed in its code. |
 * | `data` | Read by Data, and fixed in its code. |
 * | `deployment` | A capability of the records: the policies of the deployment name it. |
 * | `tenant` | Written by an operator in a role or a right, and described by nobody. |
 */
export type PermissionSource = 'console' | 'data' | 'deployment' | 'tenant'

/** A permission of a tenant, as every page describes it. */
export interface PermissionEntry {
  readonly key: string
  /** The part of the key before its first dot: what the lists group by. */
  readonly family: string
  /** What the permission opens, as a sentence, or null when nobody describes it. */
  readonly opens: string | null
  readonly source: PermissionSource
  /** Where a right has to hold to open it, or null when the console cannot say. */
  readonly reach: Reach | null
  /** Whether the permission is a capability of the platform: only the platform gives it. */
  readonly platform: boolean
  /** The roles that hold the permission themselves, by key. */
  readonly roles: readonly string[]
}

/** What the tenant holds beside its rights: what describes a permission. */
export interface PermissionContext {
  readonly roles: readonly Role[]
  /** The capabilities of the deployment, when the console read them. */
  readonly capabilities?: readonly DeploymentCapability[]
}

/** The sentence of a capability of the deployment: `Opens the reading of Articles.` */
function sentenceOf(capability: DeploymentCapability): string {
  const words = opensOf(capability)
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`
}

/**
 * The entry of one permission.
 *
 * @param key the key of the permission.
 * @param context the roles of the tenant and the capabilities of the deployment.
 */
export function permissionEntryOf(key: string, context: PermissionContext): PermissionEntry {
  const roles = context.roles
    .filter((role) => role.permissions.includes(key))
    .map((role) => role.key)
    .sort()
  const base = { key, family: familyOf(key), platform: isPlatformKey(key), roles }
  const known = knownPermission(key)
  if (known) {
    return {
      ...base,
      opens: known.opens,
      source: known.reader === 'console' ? 'console' : 'data',
      reach: known.reach,
    }
  }
  const capability = context.capabilities?.find((entry) => entry.key === key)
  if (capability) {
    // Data reads the capabilities of the records on the workspace of the request.
    return { ...base, opens: sentenceOf(capability), source: 'deployment', reach: 'workspace' }
  }
  return { ...base, opens: null, source: 'tenant', reach: null }
}

/**
 * The permissions of a tenant: the ones the console and Data fix, the
 * capabilities of the deployment, and the keys the rights and the roles
 * of the tenant name, in the order of their keys.
 *
 * @param grants the rights of the tenant.
 * @param context the roles of the tenant and the capabilities of the deployment.
 */
export function permissionCatalogOf(
  grants: readonly Grant[],
  context: PermissionContext
): PermissionEntry[] {
  const keys = new Set([
    ...knownPermissionsOf(grants, context.roles),
    ...(context.capabilities ?? []).map((capability) => capability.key),
  ])
  return [...keys].sort().map((key) => permissionEntryOf(key, context))
}

/** The entries of one family of permissions. */
export interface PermissionFamily {
  readonly family: string
  readonly entries: readonly PermissionEntry[]
}

/** The entries of a list, family by family, in the order of the families. */
export function permissionFamiliesOf(entries: readonly PermissionEntry[]): PermissionFamily[] {
  const families = new Map<string, PermissionEntry[]>()
  for (const entry of entries) {
    families.set(entry.family, [...(families.get(entry.family) ?? []), entry])
  }
  return [...families]
    .map(([family, rows]) => ({ family, entries: rows }))
    .sort((left, right) => left.family.localeCompare(right.family))
}

/** Who holds a permission: the roles that hold it in effect, and the live rights that give it. */
export interface PermissionUse {
  /** The roles that hold the permission, themselves or through a role they include, by key. */
  readonly roles: readonly string[]
  /** How many of the rights give the permission, as it is or in a role. */
  readonly rights: number
}

/**
 * Who holds a permission.
 *
 * @param key the key of the permission.
 * @param grants the live rights of the tenant.
 * @param roles the roles of the tenant.
 */
export function permissionUseOf(
  key: string,
  grants: readonly Grant[],
  roles: readonly Role[]
): PermissionUse {
  return {
    roles: roles
      .filter((role) => permissionsOfRole(role.key, roles).includes(key))
      .map((role) => role.key)
      .sort(),
    rights: grants.filter((grant) => permissionsOfGrant(grant, roles).includes(key)).length,
  }
}

/** What a role lets its holders do, in the sentences of its permissions. */
export interface RoleSummary {
  /** What the permissions of the role open, one sentence per thing, in the order of their keys. */
  readonly opens: readonly string[]
  /** The permissions of the role nobody describes, by key. */
  readonly undescribed: readonly string[]
}

/**
 * What a role lets its holders do: what the permissions it holds in
 * effect open, the ones of the roles it includes among them.
 *
 * @param role the key of the role.
 * @param context the roles of the tenant and the capabilities of the deployment.
 */
export function roleSummaryOf(role: string, context: PermissionContext): RoleSummary {
  const entries = permissionsOfRole(role, context.roles).map((key) =>
    permissionEntryOf(key, context)
  )
  return {
    opens: [...new Set(entries.flatMap((entry) => (entry.opens ? [entry.opens] : [])))],
    undescribed: entries.filter((entry) => entry.opens === null).map((entry) => entry.key),
  }
}
