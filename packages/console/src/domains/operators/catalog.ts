/**
 * The permissions the console knows the meaning of.
 *
 * A permission is a key, and what a key allows is the business of the
 * service that reads it. The console reads three keys of its own, and
 * Data reads four whose names are fixed in its code: for those seven the
 * console says what a right opens, and where the right has to hold to
 * open it. Every other key is the deployment's own: the policies of Data
 * name it, and the console says nothing about it.
 *
 * Where a key is read matters to the operator who grants it. The console
 * asks Access about the tenant itself — the slug of the tenant as the
 * workspace, on the route of the console — and Data asks about the
 * workspace of the request, on the route of the request. A right that
 * holds where its key is never read opens nothing, and Access accepts it
 * without a word: the console says so before the operator grants it.
 */

import { CONSOLE_KEYS, DATA_KEYS, PLATFORM_KEYS } from './scope'

/** Where a permission is read: on the tenant itself, or on a workspace of it. */
export type Reach = 'tenant' | 'workspace'

/**
 * Who reads a permission, and so on which route a right has to hold.
 *
 * | Reader | The right holds on |
 * | --- | --- |
 * | `console` | Every route, or the route of the console. |
 * | `data` | Every route, or a route of the gateway that serves Data. |
 * | `both` | Every route: the console reads the key on its route and Data on its own. |
 */
type Reader = 'console' | 'data' | 'both'

/** A permission the console knows the meaning of. */
export interface KnownPermission {
  readonly key: string
  /** What the permission is, in a few words. */
  readonly title: string
  /** What the permission opens, as a sentence. */
  readonly opens: string
  readonly reach: Reach
  readonly reader: Reader
  /** Whether the permission is a capability of the platform: only the platform gives it. */
  readonly platform: boolean
}

const known = (
  key: string,
  reach: Reach,
  reader: Reader,
  title: string,
  opens: string
): KnownPermission => ({
  key,
  title,
  opens,
  reach,
  reader,
  platform: PLATFORM_KEYS.includes(key),
})

/** The permissions the console knows the meaning of, the keys of the console first. */
export const KNOWN_PERMISSIONS: readonly KnownPermission[] = [
  known(
    CONSOLE_KEYS.admin,
    'tenant',
    'console',
    'Administration of the tenant',
    'Opens the administration of the tenant: users, groups, roles, rights.'
  ),
  known(
    CONSOLE_KEYS.platform,
    'tenant',
    'console',
    'Administration of every tenant',
    'Opens the administration of every tenant of the platform.'
  ),
  known(
    CONSOLE_KEYS.status,
    'tenant',
    'console',
    'Status detail',
    'Opens the detail of the status: versions, readiness, latencies.'
  ),
  known(
    DATA_KEYS.workspaceCreate,
    'tenant',
    'both',
    'Workspace creation',
    'Creates workspaces of the tenant.'
  ),
  known(
    DATA_KEYS.modelRead,
    'workspace',
    'data',
    'Data model, read',
    'Reads the data model of a workspace.'
  ),
  known(
    DATA_KEYS.modelWrite,
    'workspace',
    'data',
    'Data model, changed',
    'Reads and changes the data model of a workspace.'
  ),
  known(DATA_KEYS.auditRead, 'workspace', 'data', 'Audit', 'Reads the audit of a workspace.'),
]

const BY_KEY = new Map(KNOWN_PERMISSIONS.map((permission) => [permission.key, permission]))

/** What the console knows of a permission, or null for a key of the deployment's own. */
export function knownPermission(key: string): KnownPermission | null {
  return BY_KEY.get(key) ?? null
}

/**
 * The family of a permission: the part of its key before the first dot.
 *
 * The keys of a deployment are written `content.read`, `content.write`:
 * the family is what an operator groups them by.
 */
export function familyOf(key: string): string {
  const dot = key.indexOf('.')
  return dot > 0 ? key.slice(0, dot) : key
}

/** Where a right holds: on the tenant itself, on every workspace of it, or on one. */
export type Where = 'tenant' | 'all' | 'one'

/**
 * Where a right holds, from the workspace it names.
 *
 * A right that names no workspace holds on every one, and on the tenant
 * itself. A right that names the slug of its tenant holds on the tenant
 * itself: it is what the console asks Access about.
 */
export function whereOf(workspaceId: string | null, tenant: string): Where {
  if (workspaceId === null) return 'all'
  return workspaceId === tenant ? 'tenant' : 'one'
}

/** The place of a right: where it holds, and the route it is limited to. */
export interface RightPlace {
  readonly where: Where
  /** The route the right is limited to, or null for every route. */
  readonly routeId: string | null
}

/** Known permissions of a right that open nothing where it holds, for one reason. */
export interface Inert {
  readonly keys: readonly string[]
  /** The reason, as one sentence that names the keys. */
  readonly why: string
}

/** What a right opens where it holds, as far as the console can say. */
export interface RightEffect {
  /** What the known permissions of the right open there. */
  readonly opens: readonly { readonly key: string; readonly opens: string }[]
  /** The known permissions that open nothing there, one entry per reason. */
  readonly inert: readonly Inert[]
  /** How many permissions of the right are the deployment's own. */
  readonly others: number
}

/** Where a key is read, and the place of the right that is not it. */
interface Mismatch {
  readonly read: string
  readonly here: string
}

/** Why a known permission opens nothing in a place, or null when it opens what it opens. */
function inertIn(
  permission: KnownPermission,
  place: RightPlace,
  consoleRoute: string
): Mismatch | null {
  const { reach, reader } = permission
  if (reach === 'tenant' && place.where === 'one') {
    return { read: 'on the tenant itself', here: 'on one workspace' }
  }
  if (reach === 'workspace' && place.where === 'tenant') {
    return { read: 'on a workspace', here: 'on the tenant itself' }
  }
  if (place.routeId === null) return null
  if (reader === 'console' && place.routeId !== consoleRoute) {
    return { read: `on the route ${consoleRoute}`, here: `on the route ${place.routeId}` }
  }
  if (reader === 'data' && place.routeId === consoleRoute) {
    return { read: 'on a route that serves Data', here: `on the route ${consoleRoute}` }
  }
  if (reader === 'both') {
    return {
      read: `on the route ${consoleRoute} and on the route that serves Data`,
      here: 'limited to one route',
    }
  }
  return null
}

/** The keys of a sentence: `a`, `a and b`, `a, b and c`. */
function namesOf(keys: readonly string[]): string {
  if (keys.length <= 1) return keys.join('')
  return `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]}`
}

/**
 * What a right opens where it holds.
 *
 * The answer is about the permissions the console knows: the others are
 * counted, and Data decides what they allow. It is an explanation and
 * never a decision: Access accepts the right either way.
 *
 * @param keys the permissions the right gives, a role expanded.
 * @param place where the right holds.
 * @param consoleRoute the route of the console at Access.
 */
export function effectOf(
  keys: readonly string[],
  place: RightPlace,
  consoleRoute: string
): RightEffect {
  const opens: { key: string; opens: string }[] = []
  const mismatches = new Map<string, { mismatch: Mismatch; keys: string[] }>()
  let others = 0
  for (const key of [...new Set(keys)].sort()) {
    const permission = knownPermission(key)
    if (!permission) {
      others += 1
      continue
    }
    const mismatch = inertIn(permission, place, consoleRoute)
    if (!mismatch) {
      opens.push({ key, opens: permission.opens })
      continue
    }
    const reason = `${mismatch.read}|${mismatch.here}`
    const entry = mismatches.get(reason) ?? { mismatch, keys: [] }
    entry.keys.push(key)
    mismatches.set(reason, entry)
  }
  const inert = [...mismatches.values()].map(({ mismatch, keys: named }) => {
    const one = named.length === 1
    return {
      keys: named,
      why: `${namesOf(named)} ${one ? 'is' : 'are'} read ${mismatch.read}: ${mismatch.here} ${one ? 'it opens' : 'they open'} nothing.`,
    }
  })
  return { opens, inert, others }
}
