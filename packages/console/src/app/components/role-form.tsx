/**
 * The form of a role: its creation, and its change.
 *
 * Access replaces the permissions and the included roles of a role with
 * the lists it is sent. The form starts from what the role holds, so a
 * change is an addition or a removal of a chip, never a list retyped.
 */

import type { Role, RoleInput } from '../../domains/access'
import { rolesIncluding } from '../../domains/operators'
import type { Draft } from '../../domains/session'
import ChipPicker from '../islands/chip-picker'
import type { SentForm } from '../middleware/forms'

/** The name of the role form: the draft of a refused role comes back to it. */
export const ROLE_FORM = 'role'

/** The pattern of a key of Access. */
export const KEY_PATTERN = '[a-z0-9][a-z0-9._\\-]{0,63}'

/** The values of a list field of a draft: the list fields are kept one per line. */
export function draftList(draft: Draft | null, name: string): string[] | null {
  if (!draft || draft.values[name] === undefined) return null
  return draft.values[name]!.split('\n').filter(Boolean)
}

/** The input of the upsert of a role, from its form. */
export function roleInputOf(form: SentForm, tenant: string): RoleInput {
  const list = (name: string) => [
    ...new Set(
      form
        .all(name)
        .map((entry) => entry.trim())
        .filter(Boolean)
    ),
  ]
  return {
    tenant,
    key: form.get('key').trim(),
    displayName: form.get('displayName').trim() || null,
    description: form.get('description').trim() || null,
    permissions: list('permissions'),
    roles: list('roles'),
  }
}

/** The draft of a refused role form: its list fields one per line. */
export function roleDraftOf(form: SentForm, problems: Draft['problems']): Draft {
  return {
    form: ROLE_FORM,
    values: {
      ...form.fields,
      permissions: form.all('permissions').join('\n'),
      roles: form.all('roles').join('\n'),
    },
    problems,
  }
}

/** The form of a role. */
export function RoleForm(props: {
  action: string
  role?: Role
  roles: readonly Role[]
  permissions: readonly string[]
  draft?: Draft | null
}) {
  const { role, draft } = props
  const value = (name: string, fallback: string) => draft?.values[name] ?? fallback
  // A role may not include itself, nor a role that includes it: Access refuses the cycle.
  const excluded = new Set(
    role ? [role.key, ...rolesIncluding(role.key, props.roles).map((entry) => entry.key)] : []
  )
  const includable = props.roles.filter((entry) => !excluded.has(entry.key))
  const problem = (field: string) =>
    draft?.problems.find((entry) => entry.field === field)?.message ?? null
  return (
    <form method="post" action={props.action} class="form">
      <input type="hidden" name="_action" value="save" />
      <input type="hidden" name="_form" value={ROLE_FORM} />
      <div class="form-grid">
        {role ? (
          <input type="hidden" name="key" value={role.key} />
        ) : (
          <label class="field">
            <span>Key</span>
            <input
              name="key"
              required
              pattern={KEY_PATTERN}
              title="Lower-case letters, digits, dots, dashes and underscores"
              placeholder="editor"
              class="mono"
              value={value('key', '')}
              aria-invalid={problem('key') ? 'true' : undefined}
            />
            {problem('key') ? (
              <span class="problem">{problem('key')}</span>
            ) : (
              <span class="hint">How grants name it. It cannot change later.</span>
            )}
          </label>
        )}
        <label class="field">
          <span>Name</span>
          <input
            name="displayName"
            placeholder="Editors"
            value={value('displayName', role?.displayName ?? '')}
          />
        </label>
        <label class="field wide">
          <span>Description</span>
          <input
            name="description"
            placeholder="What people with this role do"
            value={value('description', role?.description ?? '')}
          />
        </label>
      </div>
      <div class="field">
        <label for="role-permissions">Permissions</label>
        <ChipPicker
          id="role-permissions"
          name="permissions"
          label="Add a permission"
          placeholder="Add a permission: type to search, or a new key"
          emptyText="No permission of its own."
          allowNew
          newPattern={KEY_PATTERN}
          trackChanges={role !== undefined}
          noun={['permission', 'permissions']}
          candidates={props.permissions.map((permission) => ({
            value: permission,
            label: permission,
          }))}
          selected={draftList(draft ?? null, 'permissions') ?? [...(role?.permissions ?? [])]}
        />
      </div>
      <div class="field">
        <label for="role-roles">Includes roles</label>
        <ChipPicker
          id="role-roles"
          name="roles"
          label="Include a role"
          placeholder="Include another role: its permissions become this role's"
          emptyText="Includes no other role."
          trackChanges={role !== undefined}
          noun={['role', 'roles']}
          candidates={includable.map((entry) => ({
            value: entry.key,
            label: entry.displayName ?? entry.key,
            hint: entry.permissions.join(', ') || 'no permission of its own',
          }))}
          selected={draftList(draft ?? null, 'roles') ?? [...(role?.roles ?? [])]}
        />
        {problem('roles') ? <span class="problem">{problem('roles')}</span> : null}
      </div>
      <div class="row">
        <button type="submit" class="button">
          {role ? 'Save role' : 'Create role'}
        </button>
      </div>
    </form>
  )
}
