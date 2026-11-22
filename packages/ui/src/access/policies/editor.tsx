import { useState } from 'preact/hooks'
import { type PolicyInfo, type RoleInfo, choicesOf, columnsOf, tablesIn } from '@platform/data'
import {
  type PolicyDraft,
  dropPolicyStatement,
  literal,
  policyChecks,
  policyReads,
  policyStatement,
} from '@platform/vocabulary'
import { useSession } from '../../session.tsx'
import { Notice, Statement } from '../../ui/bits.tsx'
import { Button } from '../../ui/button.tsx'
import { Drawer } from '../../ui/overlay.tsx'
import { changeOf } from '../grants/change.ts'
import { draftOf } from './draft.ts'
import { PolicyForm } from './form.tsx'
import { offeredRoles } from './roles.tsx'
import { RunnerProblem, useRunner } from '../runner.tsx'

/** What a policy drawer is opened on: a new policy for a collection, or one to change. */
export type PolicyTarget = { table: string; policy?: PolicyInfo }

const emptyDraft = (schema: string, table: string): PolicyDraft => ({
  schema,
  table,
  name: '',
  permissive: true,
  command: 'ALL',
  roles: [],
  using: '',
  check: '',
})

/**
 * Writes a row policy, or changes one. The database changes a policy's roles and expressions
 * in place but not what it is for, so a changed policy is dropped and made again, in the
 * one transaction every change runs in: no statement ever sees the collection without it.
 */
export function PolicyEditor({
  open,
  schema,
  target,
  roles,
  onClose,
  onDone,
}: {
  open: boolean
  schema: string
  target: PolicyTarget
  roles: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const { catalog } = useSession()
  const runner = useRunner()
  const original = target.policy
  const owned = tablesIn(catalog, schema).filter((t) => t.can_alter && t.kind !== 'v')
  const [draft, setDraft] = useState<PolicyDraft>(() =>
    original ? draftOf(original) : emptyDraft(schema, target.table || (owned[0]?.name ?? ''))
  )
  const [other, setOther] = useState('')
  const set = (changes: Partial<PolicyDraft>) => setDraft({ ...draft, ...changes })
  const table = owned.find((t) => t.name === draft.table)
  const columns = columnsOf(catalog, schema, draft.table)
  const reads = policyReads(draft.command)
  const checks = policyChecks(draft.command)
  const change = changeOf(() => {
    const create = policyStatement(draft, { requireExpression: true })
    return original
      ? [dropPolicyStatement(schema, original.table, original.name), create]
      : [create]
  })
  const statements = change.statements
  const invalid = change.problem
  // Expressions worth starting from, written for the fields this collection has.
  const stamped = columns.some((c) => c.name === 'created_by')
  const listed = columns
    .map((c) => ({ name: c.name, choices: choicesOf(catalog, schema, draft.table, c.name) }))
    .find((c) => c.choices?.length)
  const starts = [
    ...(stamped ? [{ label: 'Rows they made', expression: 'created_by = session_user' }] : []),
    ...(listed
      ? [
          {
            label: `Rows where ${listed.name} is ${listed.choices!.at(-1)}`,
            expression: `${listed.name} = ${literal(listed.choices!.at(-1))}`,
          },
        ]
      : []),
    { label: 'Every row', expression: 'true' },
  ]
  const toggleRole = (name: string, on: boolean) =>
    set({ roles: on ? [...draft.roles, name] : draft.roles.filter((x) => x !== name) })
  return (
    <Drawer
      open={open}
      onClose={onClose}
      wide
      title={
        original ? (
          <>
            Change <span class="mono">{original.name}</span>
          </>
        ) : (
          'New row policy'
        )
      }
      subtitle="An expression the database adds to every statement on the collection. Only the collection’s owner may write its policies."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            busy={runner.busy}
            disabled={!!invalid}
            onClick={async () => {
              if (
                await runner.runStatements(
                  statements,
                  original ? `Changed ${draft.name}` : `Created ${draft.name}`
                )
              ) {
                onDone()
                onClose()
              }
            }}
          >
            {original ? 'Change policy' : 'Create policy'}
          </Button>
        </>
      }
    >
      <RunnerProblem runner={runner} />
      {table && !table.rls && (
        <Notice tone="warning" title={`Row security is off on ${draft.table}`}>
          The database keeps the policy and applies none of it until row security is turned on.
        </Notice>
      )}
      <PolicyForm
        owned={owned}
        draft={draft}
        fixedTable={Boolean(original)}
        set={set}
        reads={reads}
        checks={checks}
        starts={starts}
        offered={offeredRoles(roles, draft.roles)}
        other={other}
        setOther={setOther}
        onToggleRole={toggleRole}
        onAddRole={() => {
          toggleRole(other.trim(), true)
          setOther('')
        }}
      />
      {invalid ? (
        <Notice tone="warning" title={invalid} />
      ) : (
        <Statement sql={statements.join('\n')} label="Runs as you, in one transaction" />
      )}
    </Drawer>
  )
}
