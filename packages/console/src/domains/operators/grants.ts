/**
 * The grant of a right, as an operator writes it.
 *
 * Access creates a permission it does not know the first time a grant
 * names it: a typo, or the key of a role written as a permission, is a
 * new permission nobody holds anywhere else. The console asks first. It
 * reads the grant form, says what is wrong with it field by field, and
 * names a new permission before Access creates it.
 */

import type { Grant } from '../access'

const DAY = 24 * 60 * 60 * 1000
const DAYS: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 }

/**
 * The moment a right ends, from the choice of the form: `never`, `1d`,
 * `7d`, `30d`, `90d`, or `custom` with a moment.
 *
 * A custom moment without a zone is read in UTC, the zone every moment
 * of the console is shown in. It throws a RangeError for a moment that is
 * not one, or one that is already past.
 */
export function expiryOf(choice: string, custom: string, now = Date.now()): string | null {
  if (choice === 'never' || choice === '') return null
  const days = DAYS[choice]
  if (days !== undefined) return new Date(now + days * DAY).toISOString()
  const text = custom.trim()
  if (!text) throw new RangeError('choose the moment the right ends')
  const at = new Date(/(?:z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}Z`)
  if (Number.isNaN(at.getTime())) throw new RangeError('the moment the right ends is not a date')
  if (at.getTime() <= now) throw new RangeError('the moment the right ends is already past')
  return at.toISOString()
}

/** The grant form, as it was sent. */
export interface GrantDraft {
  /** `user:<id>` or `group:<key>`. */
  readonly holder: string
  readonly kind: string
  readonly role: string
  readonly permission: string
  /** Whether the operator confirmed the creation of a permission the tenant does not name. */
  readonly createPermission: boolean
  readonly workspace: string
  readonly workspaceId: string
  readonly routeId: string
  readonly expires: string
  readonly expiresAt: string
}

/** What is wrong with a field of the grant form. */
export interface GrantProblem {
  readonly field: string
  readonly message: string
}

/** A grant form that holds: the grant to send, without its tenant and its author. */
export interface CheckedGrant {
  readonly userId?: string
  readonly group?: string
  readonly permission?: string
  readonly role?: string
  readonly workspaceId: string | null
  readonly routeId: string | null
  readonly expiresAt: string | null
}

const KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/

/** Reads a grant form: the grant it names, or what is wrong with it. */
export function checkGrant(
  draft: GrantDraft,
  known: { readonly permissions: readonly string[]; readonly roles: readonly string[] },
  now = Date.now()
): { grant: CheckedGrant } | { problems: GrantProblem[] } {
  const problems: GrantProblem[] = []
  const [holderKind, holderId = ''] = draft.holder.split(/:(.*)/s)
  if ((holderKind !== 'user' && holderKind !== 'group') || !holderId) {
    problems.push({ field: 'holder', message: 'Choose a user or a group.' })
  }

  const role = draft.kind === 'role'
  const roleKey = draft.role.trim()
  const permission = draft.permission.trim()
  if (role) {
    if (!roleKey) problems.push({ field: 'role', message: 'Choose a role.' })
    else if (!known.roles.includes(roleKey)) {
      problems.push({ field: 'role', message: `The tenant has no role ${roleKey}.` })
    }
  } else if (!permission) {
    problems.push({ field: 'permission', message: 'Name a permission.' })
  } else if (!KEY.test(permission)) {
    problems.push({
      field: 'permission',
      message: 'A permission is lower-case letters, digits, dots, dashes and underscores.',
    })
  } else if (known.roles.includes(permission)) {
    problems.push({
      field: 'permission',
      message: `${permission} is a role. Choose “Role” to grant it, or Access would create a permission of the same name.`,
    })
  } else if (!known.permissions.includes(permission) && !draft.createPermission) {
    problems.push({
      field: 'permission',
      message: `No grant or role of this tenant names ${permission}. Check the spelling, or confirm that Access should create it.`,
    })
  }

  const workspaceId = draft.workspace === 'one' ? draft.workspaceId.trim() : ''
  if (draft.workspace === 'one' && !workspaceId) {
    problems.push({ field: 'workspaceId', message: 'Name the workspace, or choose every one.' })
  }

  let expiresAt: string | null = null
  try {
    expiresAt = expiryOf(draft.expires, draft.expiresAt, now)
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    problems.push({ field: 'expiresAt', message: `${capitalize(error.message)}.` })
  }

  if (problems.length > 0) return { problems }
  return {
    grant: {
      ...(holderKind === 'group' ? { group: holderId } : { userId: holderId }),
      ...(role ? { role: roleKey } : { permission }),
      workspaceId: workspaceId || null,
      routeId: draft.routeId.trim() || null,
      expiresAt,
    },
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The filter of the list of the rights. */
export interface RightsFilter {
  /** A part of the name of the holder. */
  readonly holder: string
  /** A part of the permission or of the role. */
  readonly right: string
  /** A part of the workspace. */
  readonly workspace: string
}

/** Reports whether a filter holds anything. */
export function isFiltered(filter: RightsFilter): boolean {
  return Boolean(filter.holder.trim() || filter.right.trim() || filter.workspace.trim())
}

/** Reports whether a grant, held by the holder of that name, matches a filter. */
export function matchesRightsFilter(
  grant: Grant,
  holderLabel: string,
  filter: RightsFilter
): boolean {
  const has = (value: string | null | undefined, needle: string) =>
    needle.trim() === '' || (value ?? '').toLowerCase().includes(needle.trim().toLowerCase())
  return (
    has(holderLabel, filter.holder) &&
    has(grant.permission ?? grant.role, filter.right) &&
    (filter.workspace.trim() === '' ||
      (grant.workspaceId === null
        ? 'every workspace'.includes(filter.workspace.trim().toLowerCase())
        : has(grant.workspaceId, filter.workspace)))
  )
}
