import { useState } from 'preact/hooks'
import { type GrantInfo, type RoleInfo, columnsOf, tableOf } from '@platform/data'
import { type Wanted, grantChangeStatements } from '@platform/vocabulary'
import { useSession } from '../../session.tsx'
import { Notice, Statement } from '../../ui/bits.tsx'
import { Button } from '../../ui/button.tsx'
import { Drawer } from '../../ui/overlay.tsx'
import { changeOf } from '../grants/change.ts'
import { FieldAccessRole } from './role.tsx'
import { FieldGrantsTable } from './grants.tsx'
import { granteesOf, heldBy, heldOf, perField, wantedOf } from '../model.ts'
import { named } from '../names.ts'
import { RunnerProblem, useRunner } from '../runner.tsx'
import { sameWanted, toggleField } from '../grants/wishes.ts'

export function FieldAccessEditor({
  open,
  schema,
  table,
  column,
  grants,
  roles,
  onClose,
  onDone,
}: {
  open: boolean
  schema: string
  table: string
  column: string
  grants: GrantInfo[]
  roles: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const { catalog } = useSession()
  const runner = useRunner()
  const info = tableOf(catalog, schema, table)
  const owner = Boolean(info?.can_alter)
  const every = columnsOf(catalog, schema, table).map((c) => c.name)
  const [edits, setEdits] = useState<Record<string, Record<string, Wanted>>>({})
  const [added, setAdded] = useState<string[]>([])
  const [adding, setAdding] = useState('')
  const existing = granteesOf(grants, table, info?.owner ?? '')
  const grantees = [...existing, ...added.filter((name) => !existing.includes(name))]
  const held = (grantee: string) => heldBy(grants, table, grantee)
  const wanted = (grantee: string, privilege: string): Wanted =>
    edits[grantee]?.[privilege] ?? wantedOf(held(grantee)[privilege])
  const holds = (grantee: string, privilege: string): boolean => {
    const now = wanted(grantee, privilege)
    return now === 'all' || (Array.isArray(now) && now.includes(column))
  }
  const toggle = (grantee: string, privilege: string, on: boolean) => {
    const stored = wantedOf(held(grantee)[privilege])
    const next = toggleField(wanted(grantee, privilege), privilege, column, on, every)
    const mine = { ...edits[grantee] }
    if (sameWanted(next, stored)) delete mine[privilege]
    else mine[privilege] = next
    setEdits({ ...edits, [grantee]: mine })
  }
  const change = changeOf(() =>
    grantees.flatMap((grantee) =>
      grantChangeStatements({
        schema,
        table,
        grantee,
        held: held(grantee),
        wanted: edits[grantee] ?? {},
      })
    )
  )
  const statements = change.statements
  const problem = change.problem
  const narrowed = grantees.some((grantee) =>
    perField.some(
      (privilege) =>
        heldOf(held(grantee), privilege).whole && Array.isArray(wanted(grantee, privilege))
    )
  )
  const add = () => {
    const name = named(adding)
    if (!name || grantees.includes(name) || name === info?.owner) return
    setAdded([...added, name])
    setAdding('')
  }
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <>
          Access to <span class="mono">{column}</span>
        </>
      }
      subtitle={`Who may read and write this field of ${table}. A field’s metadata is read by the same roles.`}
      footer={
        owner ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              tone="primary"
              busy={runner.busy}
              disabled={!statements.length || !!problem}
              onClick={async () => {
                if (await runner.runStatements(statements, `Changed who holds ${column}`)) {
                  onDone()
                  onClose()
                }
              }}
            >
              Apply
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <RunnerProblem runner={runner} />
      <FieldGrantsTable
        info={info}
        roles={roles}
        grantees={grantees}
        column={column}
        owner={owner}
        held={held}
        wanted={wanted}
        holds={holds}
        toggle={toggle}
      />
      {!grantees.length && (
        <p class="drawer-note">
          No role is granted this field: only the owner of {table} reads and writes it.
        </p>
      )}
      {owner && (
        <FieldAccessRole
          grantees={grantees}
          owner={info?.owner}
          roles={roles}
          adding={adding}
          setAdding={setAdding}
          onAdd={add}
        />
      )}
      {narrowed && (
        <Notice tone="warning" title="A privilege on the whole collection becomes a list of fields">
          The database cannot take one field out of a grant on the whole collection, so the grant is
          revoked and made again on the other fields by name. A field added later is not among them
          until it is granted too.
        </Notice>
      )}
      {owner &&
        (problem ? (
          <Notice tone="warning" title={problem} />
        ) : statements.length ? (
          <Statement sql={statements.join('\n')} label="Runs as you, in one transaction" />
        ) : null)}
      {!owner && (
        <p class="drawer-note">
          The database gives grants on {table} to its owner, {info?.owner}, and its members.
        </p>
      )}
    </Drawer>
  )
}
