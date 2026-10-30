/**
 * The fields of the grant of a right.
 *
 * A right is a role or a single permission, held by a user or a group,
 * on a workspace and a route, until a moment. The fields say it in that
 * order, and the line under them says the right in words before it is
 * granted. A role is chosen among the roles of the tenant; a permission
 * that no grant and no role of the tenant names is a new permission, and
 * the fields say so before Access creates it. The page checks it again.
 */

import { useState } from 'hono/jsx'
import { Picker } from '../components/picker'

interface Option {
  readonly value: string
  readonly label: string
  readonly hint?: string
}

interface RoleOption {
  readonly key: string
  readonly label: string
  readonly permissions: readonly string[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const EXPIRIES: readonly { value: string; label: string; words: string }[] = [
  { value: 'never', label: 'Never', words: 'with no end' },
  { value: '1d', label: 'In 1 day', words: 'for 1 day' },
  { value: '7d', label: 'In 7 days', words: 'for 7 days' },
  { value: '30d', label: 'In 30 days', words: 'for 30 days' },
  { value: '90d', label: 'In 90 days', words: 'for 90 days' },
  { value: 'custom', label: 'On a date…', words: '' },
]

export default function GrantFields(props: {
  /** The users and the groups a right may be granted to, as `user:<id>` and `group:<key>`. */
  holders?: readonly Option[]
  /** The holder of every right of the form, when the page is the one of a user or a group. */
  fixedHolder?: Option
  roles: readonly RoleOption[]
  permissions: readonly string[]
  workspaces: readonly string[]
  routes: readonly string[]
  /** The route of the console: its rights name the tenant, not a workspace of Data. */
  consoleRoute: string
  /** The fields of a form that was refused. */
  values?: Readonly<Record<string, string>>
  problems?: readonly { field: string; message: string }[]
  /** Distinguishes the fields of two forms of one page. */
  prefix: string
}) {
  const v = props.values ?? {}
  const [holder, setHolder] = useState(v.holder ?? props.fixedHolder?.value ?? '')
  const [kind, setKind] = useState(
    v.kind === 'permission' || v.kind === 'role'
      ? v.kind
      : props.roles.length > 0
        ? 'role'
        : 'permission'
  )
  const [role, setRole] = useState(v.role ?? props.roles[0]?.key ?? '')
  const [permission, setPermission] = useState(v.permission ?? '')
  const [create, setCreate] = useState(v.createPermission === 'yes')
  const [workspace, setWorkspace] = useState(v.workspace === 'one' ? 'one' : 'all')
  const [workspaceId, setWorkspaceId] = useState(v.workspaceId ?? '')
  const [routeId, setRouteId] = useState(v.routeId ?? '')
  const [expires, setExpires] = useState(v.expires || 'never')
  const [expiresAt, setExpiresAt] = useState(v.expiresAt ?? '')

  const problem = (field: string) =>
    props.problems?.find((entry) => entry.field === field)?.message ?? null
  const id = (field: string) => `${props.prefix}-${field}`
  const text = (event: Event) => (event.target as HTMLInputElement).value

  const chosenRole = props.roles.find((entry) => entry.key === role)
  const typed = permission.trim()
  const isRoleKey = props.roles.some((entry) => entry.key === typed)
  const isNew = typed !== '' && !isRoleKey && !props.permissions.includes(typed)
  const workspaceTyped = workspaceId.trim()
  const oddWorkspace =
    workspace === 'one' &&
    workspaceTyped !== '' &&
    !UUID.test(workspaceTyped) &&
    routeId.trim() !== props.consoleRoute

  const holderLabel =
    props.fixedHolder?.label ??
    props.holders?.find((entry) => entry.value === holder)?.label ??
    'someone'
  const what =
    kind === 'role'
      ? chosenRole
        ? `the role ${chosenRole.label} (${chosenRole.permissions.length} ${chosenRole.permissions.length === 1 ? 'permission' : 'permissions'})`
        : 'a role'
      : typed
        ? `the permission ${typed}`
        : 'a permission'
  const where =
    workspace === 'one' && workspaceTyped ? `workspace ${workspaceTyped}` : 'every workspace'
  const route = routeId.trim() ? `route ${routeId.trim()}` : 'every route'
  const until =
    expires === 'custom'
      ? expiresAt
        ? `until ${expiresAt.replace('T', ' ')} UTC`
        : 'until a date to choose'
      : (EXPIRIES.find((entry) => entry.value === expires)?.words ?? '')

  return (
    <div class="grant-fields">
      {props.fixedHolder ? (
        <input type="hidden" name="holder" value={props.fixedHolder.value} />
      ) : (
        <div class="field">
          <label for={id('holder')}>Who</label>
          <Picker
            id={id('holder')}
            onChange={(values) => setHolder(values[0] ?? '')}
            name="holder"
            label="Who gets the right: a user or a group"
            single
            candidates={props.holders ?? []}
            selected={holder ? [holder] : []}
            placeholder="Search users and groups"
            emptyText="Nobody chosen yet."
          />
          {problem('holder') ? <span class="problem">{problem('holder')}</span> : null}
        </div>
      )}

      <fieldset class="field">
        <legend>What</legend>
        <div class="segmented" role="radiogroup" aria-label="A role or a single permission">
          <label class="segment">
            <input
              type="radio"
              name="kind"
              value="role"
              checked={kind === 'role'}
              onChange={() => setKind('role')}
            />
            Role
          </label>
          <label class="segment">
            <input
              type="radio"
              name="kind"
              value="permission"
              checked={kind === 'permission'}
              onChange={() => setKind('permission')}
            />
            Single permission
          </label>
        </div>
        {kind === 'role' ? (
          props.roles.length === 0 ? (
            <span class="hint">
              The tenant has no role yet. Create one on the Roles tab, or grant a single permission.
            </span>
          ) : (
            <>
              <select
                name="role"
                aria-label="Role"
                aria-invalid={problem('role') ? 'true' : undefined}
                onChange={(event: Event) => setRole(text(event))}
              >
                {props.roles.map((entry) => (
                  <option value={entry.key} selected={entry.key === role}>
                    {entry.label === entry.key ? entry.key : `${entry.label} — ${entry.key}`}
                  </option>
                ))}
              </select>
              {chosenRole ? (
                <span class="hint">
                  {chosenRole.permissions.length === 0
                    ? 'This role holds no permission yet.'
                    : `Holds ${chosenRole.permissions.join(', ')}`}
                </span>
              ) : null}
            </>
          )
        ) : (
          <>
            <input
              name="permission"
              aria-label="Permission"
              class="mono"
              list={id('permissions')}
              placeholder="content.read"
              autocomplete="off"
              value={permission}
              aria-invalid={problem('permission') ? 'true' : undefined}
              onInput={(event: Event) => {
                setPermission(text(event))
                setCreate(false)
              }}
            />
            <datalist id={id('permissions')}>
              {props.permissions.map((entry) => (
                <option value={entry} />
              ))}
            </datalist>
            {isRoleKey ? (
              <span class="problem">
                {typed} is a role.{' '}
                <button
                  type="button"
                  class="link-button"
                  onClick={() => {
                    setRole(typed)
                    setKind('role')
                    setPermission('')
                  }}
                >
                  Grant the role instead
                </button>
              </span>
            ) : null}
            {isNew ? (
              <div class="notice warn compact">
                <span>
                  No grant or role in this tenant names <code>{typed}</code>. Granting it creates a
                  new permission.
                </span>
                <label class="check small">
                  <input
                    type="checkbox"
                    name="createPermission"
                    value="yes"
                    checked={create}
                    onChange={(event: Event) =>
                      setCreate((event.target as HTMLInputElement).checked)
                    }
                  />
                  Yes, create <code>{typed}</code>
                </label>
              </div>
            ) : null}
            {problem('permission') && !isRoleKey && !(isNew && create) ? (
              <span class="problem">{problem('permission')}</span>
            ) : null}
          </>
        )}
      </fieldset>

      <div class="form-grid">
        <fieldset class="field">
          <legend>Where</legend>
          <div class="segmented" role="radiogroup" aria-label="Which workspaces">
            <label class="segment">
              <input
                type="radio"
                name="workspace"
                value="all"
                checked={workspace === 'all'}
                onChange={() => setWorkspace('all')}
              />
              All workspaces
            </label>
            <label class="segment">
              <input
                type="radio"
                name="workspace"
                value="one"
                checked={workspace === 'one'}
                onChange={() => setWorkspace('one')}
              />
              One workspace
            </label>
          </div>
          {workspace === 'one' ? (
            <>
              <input
                name="workspaceId"
                aria-label="Workspace ID"
                class="mono"
                list={id('workspaces')}
                placeholder="11111111-1111-4111-8111-111111111111"
                autocomplete="off"
                value={workspaceId}
                aria-invalid={problem('workspaceId') || oddWorkspace ? 'true' : undefined}
                onInput={(event: Event) => setWorkspaceId(text(event))}
              />
              <datalist id={id('workspaces')}>
                {props.workspaces.map((entry) => (
                  <option value={entry} />
                ))}
              </datalist>
              {oddWorkspace ? (
                <span class="problem">
                  Data matches workspaces by their ID (a UUID): this right would open no workspace.
                </span>
              ) : (
                <span class="hint">The ID of the workspace; earlier rights suggest some.</span>
              )}
              {problem('workspaceId') ? (
                <span class="problem">{problem('workspaceId')}</span>
              ) : null}
            </>
          ) : null}
        </fieldset>
        <label class="field">
          <span>Route</span>
          <input
            name="routeId"
            list={id('routes')}
            placeholder="every route"
            autocomplete="off"
            value={routeId}
            onInput={(event: Event) => setRouteId(text(event))}
          />
          <datalist id={id('routes')}>
            {[...new Set([...props.routes, props.consoleRoute])].map((entry) => (
              <option value={entry} />
            ))}
          </datalist>
          <span class="hint">Empty: every route of the gateway.</span>
        </label>
        <div class="field">
          <label for={id('expires')}>Ends</label>
          <select
            id={id('expires')}
            name="expires"
            onChange={(event: Event) => setExpires(text(event))}
          >
            {EXPIRIES.map((entry) => (
              <option value={entry.value} selected={entry.value === expires}>
                {entry.label}
              </option>
            ))}
          </select>
          {expires === 'custom' ? (
            <>
              <input
                name="expiresAt"
                type="datetime-local"
                aria-label="The moment the right ends, in UTC"
                value={expiresAt}
                aria-invalid={problem('expiresAt') ? 'true' : undefined}
                onInput={(event: Event) => setExpiresAt(text(event))}
              />
              <span class="hint">In UTC, like every time in the console.</span>
            </>
          ) : null}
          {problem('expiresAt') ? <span class="problem">{problem('expiresAt')}</span> : null}
        </div>
      </div>

      <p class="grant-preview" aria-live="polite">
        <strong>{holderLabel}</strong> will hold <strong>{what}</strong> on {where} · {route} ·{' '}
        {until}.
      </p>
    </div>
  )
}
