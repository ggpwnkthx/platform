import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import type { PolicyInfo, RoleInfo, TableInfo } from '@platform/data'
import { dropPolicyStatement, rowSecurityStatement } from '@platform/vocabulary'
import { Badge, Statement } from '../../ui/bits.tsx'
import { Button } from '../../ui/button.tsx'
import { PlusIcon } from '../../ui/icons.tsx'
import { Confirm } from '../../ui/overlay.tsx'
import { PolicyCard, rowSecurityWords } from '../policies/card.tsx'
import { PolicyDrawer, type PolicyTarget } from '../policies/drawer.tsx'
import { RunnerProblem, useRunner } from '../runner.tsx'

/**
 * The row security of one collection: whether it is on, the policies it carries, and — for
 * the collection's owner — the statements that change either.
 */
export function CollectionPolicies({
  schema,
  table,
  policies,
  roles,
  heading,
  onDone,
}: {
  schema: string
  table: TableInfo
  /** The policies of this collection. */
  policies: PolicyInfo[]
  roles: RoleInfo[]
  /** What the section is called: the collection's name where several are listed. */
  heading?: ComponentChildren
  onDone: () => void
}) {
  const runner = useRunner()
  const [editing, setEditing] = useState<PolicyTarget | null>(null)
  const [dropping, setDropping] = useState<PolicyInfo | null>(null)
  const [switching, setSwitching] = useState(false)
  const owner = table.can_alter && table.kind !== 'v'
  const turn = rowSecurityStatement(schema, table.name, !table.rls)
  return (
    <section class="section">
      <header class="section-head">
        <div>
          <h2>
            {heading ?? 'Row security'}{' '}
            {table.rls ? <Badge tone="info">On</Badge> : <Badge>Off</Badge>}
          </h2>
          <p>{rowSecurityWords(table, policies.length)}</p>
        </div>
        {owner && (
          <div class="section-actions">
            <Button small onClick={() => setSwitching(true)}>
              {table.rls ? 'Turn off' : 'Turn on'}
            </Button>
            <Button
              small
              icon={<PlusIcon size={14} />}
              onClick={() => setEditing({ table: table.name })}
            >
              New policy
            </Button>
          </div>
        )}
      </header>
      <RunnerProblem runner={runner} />
      {policies.length > 0 && (
        <ul class="policies">
          {policies.map((policy) => (
            <PolicyCard
              key={policy.name}
              policy={policy}
              onEdit={owner ? () => setEditing({ table: table.name, policy }) : undefined}
              onDrop={owner ? () => setDropping(policy) : undefined}
            />
          ))}
        </ul>
      )}
      <PolicyDrawer
        schema={schema}
        target={editing}
        roles={roles}
        onClose={() => setEditing(null)}
        onDone={onDone}
      />
      <Confirm
        open={switching}
        title={table.rls ? 'Turn row security off?' : 'Turn row security on?'}
        confirm={table.rls ? 'Turn off' : 'Turn on'}
        tone={table.rls ? 'danger' : 'primary'}
        busy={runner.busy}
        onClose={() => setSwitching(false)}
        onConfirm={async () => {
          if (
            await runner.runStatements([turn], table.rls ? 'Row security off' : 'Row security on')
          ) {
            setSwitching(false)
            onDone()
          }
        }}
      >
        <p>
          {table.rls
            ? 'Every role reaches every row its grants let it, at once: the policies are kept and no longer applied.'
            : policies.length
              ? 'A role reaches only the rows a policy that applies to it allows.'
              : 'There is no policy yet, so nobody but the owner reaches a row until one is written.'}
        </p>
        <Statement sql={turn} />
      </Confirm>
      <Confirm
        open={dropping !== null}
        title="Drop this policy?"
        confirm="Drop policy"
        busy={runner.busy}
        onClose={() => setDropping(null)}
        onConfirm={async () => {
          if (
            dropping &&
            (await runner.runStatements(
              [dropPolicyStatement(schema, dropping.table, dropping.name)],
              `Dropped ${dropping.name}`
            ))
          ) {
            setDropping(null)
            onDone()
          }
        }}
      >
        <p>Rows it let roles reach stop being reachable through it at once.</p>
        {dropping && <Statement sql={dropPolicyStatement(schema, dropping.table, dropping.name)} />}
      </Confirm>
    </section>
  )
}
