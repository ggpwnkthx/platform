/**
 * The workspaces of the caller.
 *
 * Data has no list of the workspaces of a caller: a caller
 * names the workspace it calls. The console learns the workspaces of a
 * caller from its rights — the grants Access holds for it,
 * by itself and through its groups — read with the credential of its
 * tenant, and from the workspaces the caller opened. Whether the caller
 * may read one is the answer of Data, never the guess of the
 * console.
 */

import type { Context } from 'hono'
import type { Principal } from '../../domains/access'
import { type Right, rightsOf, workspacesOf } from '../../domains/operators'
import { sessionOf } from './session'

/** What the console knows of the workspaces of the caller. */
export interface KnownWorkspaces {
  /** The workspaces the rights of the caller name, and the ones it opened. */
  readonly ids: readonly string[]
  /** Whether a right of the caller holds for every workspace of its tenant. */
  readonly everyWorkspace: boolean
  /** Whether the rights of the caller could be read. */
  readonly rightsRead: boolean
}

/** The rights of the caller, read with the credential of its tenant. */
async function rightsOfCaller(c: Context): Promise<Right[] | null> {
  const services = c.get('services')
  const session = sessionOf(c)
  const tenant = session.principal.tenant
  const credential = services.credentials.tenants[tenant] ?? services.credentials.platform
  if (!credential) return null
  const admin = services.admin(credential)
  try {
    const grants = await admin.all((page) => admin.grants({ tenant, live: true, ...page }))
    let user: Principal | null = null
    if (session.principal.email) {
      const page = await admin.principals({ tenant, email: session.principal.email, limit: 50 })
      user = page.rows.find((row) => row.id === session.principal.id) ?? null
    }
    if (!user) {
      return grants.rows
        .filter((grant) => grant.userId === session.principal.id)
        .map((grant) => ({ grant, group: null }))
    }
    const groups = await admin.all((page) => admin.groups({ tenant, ...page }))
    return rightsOf(user, grants.rows, groups.rows)
  } catch (error) {
    services.log.warn('the rights of the caller could not be read', {
      requestId: c.get('requestId'),
      error: (error as Error).message,
    })
    return null
  }
}

/** The workspaces of the caller. */
export async function knownWorkspaces(c: Context): Promise<KnownWorkspaces> {
  const session = sessionOf(c)
  const rights = await rightsOfCaller(c)
  const found = rights
    ? workspacesOf(rights, c.get('services').config.routeId)
    : { ids: [], everyWorkspace: false }
  const ids = [...new Set([...session.workspaces, ...found.ids])]
  return { ids, everyWorkspace: found.everyWorkspace, rightsRead: rights !== null }
}

/** Remembers a workspace the caller opened: the latest first, ten at most. */
export function rememberWorkspace(c: Context, id: string): void {
  const session = sessionOf(c)
  session.workspaces = [id, ...session.workspaces.filter((known) => known !== id)].slice(0, 10)
}
