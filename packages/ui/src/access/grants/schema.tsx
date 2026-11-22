import { useState } from 'preact/hooks'
import type { RoleInfo, SchemaGrantInfo } from '@platform/data'
import { schemaGrantStatement, schemaPrivileges } from '@platform/vocabulary'
import { Notice, Statement } from '../../ui/bits.tsx'
import { Checkbox, Field } from '../../ui/form.tsx'
import { Drawer } from '../../ui/overlay.tsx'
import { changeOf } from './change.ts'
import { GrantFooter } from './footer.tsx'
import { useLast, useOpening } from '../hooks.ts'
import { named } from '../names.ts'
import { RoleInput } from '../roles/input.tsx'
import { RunnerProblem, useRunner } from '../runner.tsx'

const schemaExplains: Record<string, string> = {
  USAGE: 'Reach the collections inside, each under its own grants and row policies.',
  CREATE: 'Make collections here, and own the ones it makes.',
}

/**
 * What one role holds on the workspace's own schema: USAGE, without which nothing inside is
 * reached, and CREATE, which makes collections in it.
 */
export function SchemaGrantDrawer({
  schema,
  target,
  grants,
  roles,
  onClose,
  onDone,
}: {
  schema: string
  /** Null while the drawer is closed; the role when it is opened on one. */
  target: { grantee?: string } | null
  grants: SchemaGrantInfo[]
  roles: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const opening = useOpening(target !== null)
  const last = useLast(target)
  return (
    <SchemaGrantEditor
      key={opening}
      open={target !== null}
      schema={schema}
      fixed={last?.grantee}
      grants={grants}
      roles={roles}
      onClose={onClose}
      onDone={onDone}
    />
  )
}

function SchemaGrantEditor({
  open,
  schema,
  fixed,
  grants,
  roles,
  onClose,
  onDone,
}: {
  open: boolean
  schema: string
  fixed?: string
  grants: SchemaGrantInfo[]
  roles: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const runner = useRunner()
  const [typed, setTyped] = useState(fixed ?? '')
  const [edits, setEdits] = useState<Record<string, boolean>>({})
  const grantee = named(typed)
  const held = (privilege: string) =>
    grants.some((g) => g.grantee === grantee && g.privilege === privilege)
  // A role with nothing here yet is most often given the workspace to use.
  const fresh = !schemaPrivileges.some(held)
  const wanted = (privilege: string) =>
    edits[privilege] ?? (held(privilege) || (fresh && privilege === 'USAGE'))
  const revoked = schemaPrivileges.filter((p) => held(p) && !wanted(p))
  const granted = schemaPrivileges.filter((p) => !held(p) && wanted(p))
  const change = changeOf(() =>
    grantee
      ? [
          ...(revoked.length ? [schemaGrantStatement(schema, revoked, grantee, true)] : []),
          ...(granted.length ? [schemaGrantStatement(schema, granted, grantee)] : []),
        ]
      : []
  )
  const statements = change.statements
  const problem = change.problem
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <>
          {grantee ? <span class="mono">{grantee}</span> : 'A role'} on the workspace{' '}
          <span class="mono">{schema}</span>
        </>
      }
      subtitle="What the role holds on the workspace’s own schema. The database lets the workspace’s owner change it."
      footer={
        <GrantFooter
          statements={statements}
          problem={problem}
          grantee={grantee}
          revoking={Boolean(statements.length && !granted.length)}
          runner={runner}
          onDone={onDone}
          onClose={onClose}
        />
      }
    >
      <RunnerProblem runner={runner} />
      {!fixed && (
        <div class="form">
          <Field
            label="Role"
            id="schema-role"
            required
            wide
            hint="A group is granted once for all its members. PUBLIC is everyone."
          >
            <RoleInput
              id="schema-role"
              value={typed}
              roles={roles}
              withEveryone
              onChange={(name) => {
                setTyped(name)
                setEdits({})
              }}
            />
          </Field>
        </div>
      )}
      <section class="drawer-section">
        <h3 class="drawer-title">Privileges</h3>
        <div class="grant-checks">
          {schemaPrivileges.map((privilege) => (
            <Checkbox
              key={privilege}
              checked={wanted(privilege)}
              onChange={(on) => setEdits({ ...edits, [privilege]: on })}
              label={<span class="mono">{privilege}</span>}
              hint={schemaExplains[privilege]}
            />
          ))}
        </div>
      </section>
      {revoked.includes('USAGE') && (
        <Notice tone="warning" title={`${grantee} will reach nothing in ${schema}`}>
          Its grants on the collections inside stay in their ACLs, and the database refuses every
          statement on them until USAGE is granted again.
        </Notice>
      )}
      {problem ? (
        <Notice tone="warning" title={problem} />
      ) : statements.length ? (
        <Statement sql={statements.join('\n')} label="Runs as you, in one transaction" />
      ) : (
        <p class="drawer-note">
          {grantee ? 'Nothing changes yet: the ACL already says this.' : 'Choose a role.'}
        </p>
      )}
    </Drawer>
  )
}
