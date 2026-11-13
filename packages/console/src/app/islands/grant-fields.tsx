/**
 * The fields of the grant of a right.
 *
 * A right is a role or a single permission, held by a user or a group,
 * somewhere, until a moment. The fields ask the four questions in that
 * order — who, what, where, until when — and the lines under them say
 * the right in words before it is granted: who will hold what, where,
 * and what it opens there.
 *
 * Where a right holds is the question an operator gets wrong. The
 * console reads its own keys on the tenant itself, and Data reads its
 * keys on a workspace: a right that holds where its key is never read
 * opens nothing, and Access accepts it without a word. The fields offer
 * the three places by their names — the tenant itself, every workspace,
 * one workspace — and say what would open nothing before the operator
 * grants it.
 *
 * A role is chosen among the roles of the tenant; a permission that no
 * grant and no role of the tenant names is a new permission, and the
 * fields say so before Access creates it. The page checks it again.
 */

import { useState } from 'hono/jsx'
import { effectOf, KEY_PATTERN, type Where } from '../../domains/operators'
import { Picker } from '../components/picker'

interface Option {
  readonly value: string
  readonly label: string
  readonly hint?: string
}

interface RoleOption {
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly permissions: readonly string[]
  /** Why the operator may not grant the role, when it holds a permission that is not its to give. */
  readonly refused?: string
}

const UUID_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

const EXPIRIES: readonly { value: string; label: string; words: string }[] = [
  { value: 'never', label: 'Never', words: 'with no end' },
  { value: '1d', label: 'In 1 day', words: 'for 1 day' },
  { value: '7d', label: 'In 7 days', words: 'for 7 days' },
  { value: '30d', label: 'In 30 days', words: 'for 30 days' },
  { value: '90d', label: 'In 90 days', words: 'for 90 days' },
  { value: 'custom', label: 'On a date…', words: '' },
]

/** The places a right holds in, in the order an operator reads them. */
const PLACES: readonly Where[] = ['tenant', 'all', 'one']

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export default function GrantFields(props: {
  /** The users and the groups a right may be granted to, as `user:<id>` and `group:<key>`. */
  holders?: readonly Option[]
  /** The holder of every right of the form, when the page is the one of a user or a group. */
  fixedHolder?: Option
  roles: readonly RoleOption[]
  /** The permissions the tenant names, each with what the console knows of it. */
  permissions: readonly Option[]
  /** The permissions the operator may not give, and why. */
  locked?: Readonly<Record<string, string>>
  /** The workspaces the rights of the tenant name, by identifier, with the name Data gave them. */
  workspaces: readonly Option[]
  routes: readonly string[]
  /** The route of the console: its keys are read there. */
  consoleRoute: string
  /** The slug of the tenant: a right on the tenant itself names it. */
  tenant: string
  /** The fields of a form that was refused. */
  values?: Readonly<Record<string, string>>
  problems?: readonly { field: string; message: string }[]
  /** Distinguishes the fields of two forms of one page. */
  prefix: string
}) {
  const v = props.values ?? {}
  const keysOf = (kind: string, role: string, permission: string): readonly string[] =>
    kind === 'role'
      ? (props.roles.find((entry) => entry.key === role)?.permissions ?? [])
      : permission.trim()
        ? [permission.trim()]
        : []
  // A key of the console is read on the tenant itself: a right that
  // gives one is suggested there, until the operator chooses a place.
  const suggestedFor = (keys: readonly string[]): Where =>
    effectOf(keys, { where: 'one', routeId: null }, props.consoleRoute).inert.length > 0
      ? 'tenant'
      : 'all'

  const [holder, setHolder] = useState(v.holder ?? props.fixedHolder?.value ?? '')
  const [kind, setKind] = useState(
    v.kind === 'permission' || v.kind === 'role'
      ? v.kind
      : props.roles.length > 0
        ? 'role'
        : 'permission'
  )
  const [role, setRole] = useState(v.role ?? '')
  const [permission, setPermission] = useState(v.permission ?? '')
  const [create, setCreate] = useState(v.createPermission === 'yes')
  const [where, setWhere] = useState<Where>(
    v.workspace === 'one' || v.workspace === 'all' || v.workspace === 'tenant'
      ? v.workspace
      : suggestedFor(keysOf(kind, role, permission))
  )
  // Once the operator chose a place, the fields never move it again.
  const [placed, setPlaced] = useState(v.workspace !== undefined)
  const [workspaceId, setWorkspaceId] = useState(v.workspaceId ?? '')
  const [routeId, setRouteId] = useState(v.routeId ?? '')
  const [expires, setExpires] = useState(v.expires || 'never')
  const [expiresAt, setExpiresAt] = useState(v.expiresAt ?? '')

  const problem = (field: string) =>
    props.problems?.find((entry) => entry.field === field)?.message ?? null
  const id = (field: string) => `${props.prefix}-${field}`
  const text = (event: Event) => (event.target as HTMLInputElement).value
  const suggest = (nextKind: string, nextRole: string, nextPermission: string) => {
    if (!placed) setWhere(suggestedFor(keysOf(nextKind, nextRole, nextPermission)))
  }

  const chosenRole = props.roles.find((entry) => entry.key === role)
  const typed = permission.trim()
  const isRoleKey = props.roles.some((entry) => entry.key === typed)
  const isNew =
    typed !== '' && !isRoleKey && !props.permissions.some((entry) => entry.value === typed)
  // What the operator may not give is said here, before the page refuses it.
  const refused =
    kind === 'role'
      ? (chosenRole?.refused ?? null)
      : typed !== ''
        ? (props.locked?.[typed] ?? null)
        : null
  const workspaceTyped = workspaceId.trim()
  const workspaceLabel =
    props.workspaces.find((entry) => entry.value === workspaceTyped)?.label ?? workspaceTyped
  const route = routeId.trim()

  const holderLabel =
    props.fixedHolder?.label ??
    props.holders?.find((entry) => entry.value === holder)?.label ??
    'someone'
  const what =
    kind === 'role'
      ? chosenRole
        ? `the role ${chosenRole.label} (${count(chosenRole.permissions.length, 'permission', 'permissions')})`
        : 'a role'
      : typed
        ? `the permission ${typed}`
        : 'a permission'
  const place =
    where === 'tenant'
      ? `the tenant ${props.tenant} itself`
      : where === 'all'
        ? 'every workspace'
        : workspaceTyped
          ? `the workspace ${workspaceLabel}`
          : 'a workspace to choose'
  const until =
    expires === 'custom'
      ? expiresAt
        ? `until ${expiresAt.replace('T', ' ')} UTC`
        : 'until a date to choose'
      : (EXPIRIES.find((entry) => entry.value === expires)?.words ?? '')

  // What the right opens there, as far as the console can say.
  const keys = keysOf(kind, role, permission)
  const effect =
    keys.length > 0 ? effectOf(keys, { where, routeId: route || null }, props.consoleRoute) : null
  const opensNothing =
    effect !== null && effect.opens.length === 0 && effect.others === 0 && effect.inert.length > 0

  const placeHints: Record<Where, string> = {
    tenant: `The console reads its own keys here, and the right to create workspaces. Access writes ${props.tenant} as the workspace.`,
    all: `Every workspace of ${props.tenant}, the ones created later too, and the tenant itself.`,
    one: 'A single workspace: its records, its model and its audit.',
  }
  const placeLabels: Record<Where, string> = {
    tenant: 'The tenant itself',
    all: 'All workspaces',
    one: 'One workspace',
  }

  return (
    <div class="grant-fields">
      {props.fixedHolder ? (
        <input type="hidden" name="holder" value={props.fixedHolder.value} />
      ) : (
        <div class="field grant-step">
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

      <fieldset class="field grant-step">
        <legend>What</legend>
        <div class="segmented" role="radiogroup" aria-label="A role or a single permission">
          <label class="segment">
            <input
              type="radio"
              name="kind"
              value="role"
              checked={kind === 'role'}
              onChange={() => {
                setKind('role')
                suggest('role', role, permission)
              }}
            />
            Role
          </label>
          <label class="segment">
            <input
              type="radio"
              name="kind"
              value="permission"
              checked={kind === 'permission'}
              onChange={() => {
                setKind('permission')
                suggest('permission', role, permission)
              }}
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
                onChange={(event: Event) => {
                  setRole(text(event))
                  suggest('role', text(event), permission)
                }}
              >
                <option value="" selected={role === ''}>
                  Choose a role…
                </option>
                {props.roles.map((entry) => (
                  <option value={entry.key} selected={entry.key === role}>
                    {entry.label === entry.key ? entry.key : `${entry.label} — ${entry.key}`}
                  </option>
                ))}
              </select>
              {problem('role') ? <span class="problem">{problem('role')}</span> : null}
              {chosenRole?.refused ? <span class="problem">{chosenRole.refused}</span> : null}
              {chosenRole ? (
                <div class="role-holds">
                  {chosenRole.description ? (
                    <span class="hint">{chosenRole.description}</span>
                  ) : null}
                  {chosenRole.permissions.length === 0 ? (
                    <span class="hint">This role holds no permission yet.</span>
                  ) : (
                    <div class="chips">
                      <span class="sr-only">What the role {chosenRole.label} holds:</span>
                      {chosenRole.permissions.map((entry) => (
                        <span class="chip">
                          <code>{entry}</code>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )
        ) : (
          <>
            <Picker
              id={id('permission')}
              name="permission"
              label="Permission"
              single
              allowNew
              newPattern={KEY_PATTERN}
              candidates={props.permissions}
              selected={typed ? [typed] : []}
              placeholder="Search the permissions of the tenant, or type a key: content.read"
              emptyText="No permission chosen yet."
              onChange={(values) => {
                setPermission(values[0] ?? '')
                setCreate(false)
                suggest('permission', role, values[0] ?? '')
              }}
            />
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
                    suggest('role', typed, '')
                  }}
                >
                  Grant the role instead
                </button>
              </span>
            ) : null}
            {refused && !isRoleKey ? <span class="problem">{refused}</span> : null}
            {isNew && !refused ? (
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
            {problem('permission') && !isRoleKey && !refused && !(isNew && create) ? (
              <span class="problem">{problem('permission')}</span>
            ) : null}
          </>
        )}
      </fieldset>

      <fieldset class="field grant-step">
        <legend>Where</legend>
        <div class="choices" role="radiogroup" aria-label="Where the right holds">
          {PLACES.map((entry) => (
            <label class="choice">
              <input
                type="radio"
                class="choice-radio"
                name="workspace"
                value={entry}
                checked={where === entry}
                onChange={() => {
                  setWhere(entry)
                  setPlaced(true)
                }}
              />
              <span class="choice-text">
                <strong class="choice-name">{placeLabels[entry]}</strong>
                <span class="hint">{placeHints[entry]}</span>
              </span>
            </label>
          ))}
        </div>
        {where === 'one' ? (
          <>
            <Picker
              id={id('workspaceId')}
              name="workspaceId"
              label="Workspace"
              single
              allowNew
              newPattern={UUID_PATTERN}
              newVerb="Use"
              newHint="a workspace no right of the tenant names yet"
              candidates={props.workspaces}
              selected={workspaceTyped ? [workspaceTyped] : []}
              placeholder="Search by name, or paste the ID of the workspace"
              emptyText="No workspace chosen yet."
              onChange={(values) => setWorkspaceId(values[0] ?? '')}
            />
            {problem('workspaceId') ? (
              <span class="problem">{problem('workspaceId')}</span>
            ) : (
              <span class="hint">
                Data names the workspaces it opens to you; the others are listed by their ID.
              </span>
            )}
          </>
        ) : null}
      </fieldset>

      <div class="form-grid grant-step">
        <div class="field">
          <label for={id('expires')}>Until</label>
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
        <label class="field">
          <span>
            Route <span class="optional">optional</span>
          </span>
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
          <span class="hint">Leave it empty unless the right is for one route of the gateway.</span>
        </label>
      </div>

      <div
        class={`grant-preview ${refused ? 'refused' : opensNothing ? 'inert' : ''}`.trim()}
        aria-live="polite"
      >
        {refused ? (
          <p>
            <strong>{holderLabel}</strong> will hold nothing: <strong>{what}</strong> is not yours
            to give.
          </p>
        ) : (
          <p>
            <strong>{holderLabel}</strong> will hold <strong>{what}</strong> on{' '}
            <strong>{place}</strong>, on {route ? `the route ${route}` : 'every route'}, {until}.
          </p>
        )}
        {effect && !refused ? (
          <ul class="grant-effect">
            {effect.opens.map((entry) => (
              <li class="effect opens">
                <span class="effect-mark" aria-hidden="true">
                  ✓
                </span>
                <span>{entry.opens}</span>
              </li>
            ))}
            {effect.others > 0 ? (
              <li class="effect others">
                <span class="effect-mark" aria-hidden="true">
                  ·
                </span>
                <span>
                  {where === 'tenant'
                    ? `${count(effect.others, 'other permission is', 'other permissions are')} the deployment's own: Data reads ${effect.others === 1 ? 'it' : 'them'} on a workspace, and not on the tenant itself.`
                    : `Data's policies decide what ${count(effect.others, 'other permission allows', 'other permissions allow')}.`}
                </span>
              </li>
            ) : null}
            {effect.inert.map((entry) => (
              // A right that opens something else is not a mistake: what it
              // does not open here is a note, and a warning only when it is all.
              <li class={`effect ${opensNothing ? 'inert' : 'aside'}`}>
                <span class="effect-mark" aria-hidden="true">
                  {opensNothing ? '!' : '–'}
                </span>
                <span>{entry.why}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {opensNothing && !refused ? (
          <p class="problem">
            Granted here, this right opens nothing the console knows of. Choose another place.
          </p>
        ) : null}
      </div>

      <div class="row">
        <button
          type="submit"
          class="button"
          disabled={refused !== null}
          title={refused ?? undefined}
        >
          Grant
        </button>
      </div>
    </div>
  )
}
