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
import { DataError, type Me } from '../../domains/data'
import { isUuid, type Right, rightsOf, workspacesOf } from '../../domains/operators'
import { sessionOf, tokenIsAlive } from './session'

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
  // The address of the caller travels with the call: Access writes it in
  // the log of the call and in the audit of a change.
  const caller = c.get('callerAddress')
  const admin = services.admin(credential, ...(caller ? [caller] : []))
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

/** The name of a workspace, as Data answered it for the caller. */
function nameOf(me: Me): string | null {
  return me.workspace?.displayName ?? me.workspace?.slug ?? null
}

/** How many names of workspaces a session keeps. */
const NAMES_KEPT = 200

/** Keeps what Data answered about the name of a workspace, for the pages that follow. */
function keepName(c: Context, id: string, name: string | null): void {
  const names = sessionOf(c).workspaceNames
  const key = id.toLowerCase()
  if (!(key in names) && Object.keys(names).length >= NAMES_KEPT) return
  names[key] = name
}

/**
 * Remembers a workspace the caller opened: the latest first, ten at
 * most, and the name Data gave it.
 */
export function rememberWorkspace(c: Context, id: string, me?: Me): void {
  const session = sessionOf(c)
  session.workspaces = [id, ...session.workspaces.filter((known) => known !== id)].slice(0, 10)
  if (me) keepName(c, id, nameOf(me))
}

/** Keeps the name Data gave a workspace, or that it gave none to the caller. */
export function rememberWorkspaceName(c: Context, id: string, me: Me | null): void {
  keepName(c, id, me ? nameOf(me) : null)
}

/** How many workspaces a page asks Data to name, beyond the ones the session knows. */
const NAMES_ASKED = 8

/** How long a page waits for the names it asked for: a name that comes later is there for the next page. */
const NAMES_WAIT_MS = 1500

/** How long the console stops asking for names once Data did not answer. */
const NAMES_PAUSE_MS = 30_000

/**
 * The names of workspaces, for a page that shows rights.
 *
 * Access names a workspace by its identifier, and an identifier says
 * nothing to a reader. Data names the workspaces it opens to the caller:
 * the console asks it once per workspace and per session, a few at a
 * time, and shows the identifier of the ones Data does not open to the
 * caller. The name is a courtesy of the page and never a decision.
 *
 * A page of the administration is a page of Access, and it does not
 * wait for Data: the names that do not come in time are left to the
 * next page, and a Data that does not answer is not asked again for a
 * while.
 *
 * @param c the request.
 * @param ids the identifiers the page shows.
 * @returns the names the console knows, by identifier in lower case.
 */
export async function workspaceNames(
  c: Context,
  ids: readonly string[]
): Promise<ReadonlyMap<string, string>> {
  const services = c.get('services')
  const session = sessionOf(c)
  const wanted = [...new Set(ids.filter(isUuid).map((id) => id.toLowerCase()))]
  // A token the gateway no longer accepts asks nothing: the page keeps
  // the names the session knows, and the next one asks again.
  const asks = tokenIsAlive(session) && (session.workspaceNamesAfter ?? 0) <= Date.now()
  const unknown = asks
    ? wanted.filter((id) => !(id in session.workspaceNames)).slice(0, NAMES_ASKED)
    : []
  if (unknown.length > 0) {
    const asked = Promise.all(
      unknown.map(async (id) => {
        try {
          keepName(c, id, nameOf(await services.data(id, session.accessToken).me()))
        } catch (error) {
          // A workspace that is not open to the caller keeps its
          // identifier for the session. A call that failed is not an
          // answer: it is asked again, once Data had the time to come back.
          if (error instanceof DataError && (error.status === 403 || error.status === 404)) {
            keepName(c, id, null)
          } else {
            session.workspaceNamesAfter = Date.now() + NAMES_PAUSE_MS
          }
        }
      })
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      asked,
      new Promise((resolve) => {
        timer = setTimeout(resolve, NAMES_WAIT_MS)
      }),
    ])
    clearTimeout(timer)
  }
  const names = new Map<string, string>()
  for (const id of wanted) {
    const name = session.workspaceNames[id]
    if (name) names.set(id, name)
  }
  return names
}

/** What Access gives the caller on a workspace: the keys the policies of Data read. */
export interface WorkspaceKeys {
  /** The permissions Access gives the caller there, or null when the console could not ask. */
  readonly keys: readonly string[] | null
  /** Why the console could not ask, when it could not. */
  readonly unavailable: string | null
}

/**
 * The permissions Access gives the caller on a workspace and a route.
 *
 * It is the question Data asks before it answers: the console asks it
 * to draw what Data would refuse as closed, before the caller opens it.
 * A question the console cannot ask closes nothing.
 *
 * @param c the request.
 * @param workspaceId the workspace.
 * @param routeId the route Data serves the workspace on, as Data named it.
 */
export async function workspaceKeys(
  c: Context,
  workspaceId: string,
  routeId: string
): Promise<WorkspaceKeys> {
  const services = c.get('services')
  const session = sessionOf(c)
  if (!services.context) {
    return {
      keys: null,
      unavailable: 'The console holds no access-context credential, so it cannot ask Access.',
    }
  }
  try {
    const tenantId = await services.tenantId(session.principal.tenant)
    if (!tenantId) {
      return {
        keys: null,
        unavailable: 'The console could not read the identifier of your tenant.',
      }
    }
    const context = await services.context.context({
      subject: session.principal.id,
      tenantId,
      workspaceId,
      routeId,
    })
    return { keys: context.allow ? context.permissionKeys : [], unavailable: null }
  } catch (error) {
    services.log.warn('the access context of the caller could not be read', {
      requestId: c.get('requestId'),
      error: (error as Error).message,
    })
    return { keys: null, unavailable: 'Access did not answer the question just now.' }
  }
}
