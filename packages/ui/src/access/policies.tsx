import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import {
  type PolicyInfo,
  type RoleInfo,
  type TableInfo,
  choicesOf,
  columnsOf,
  policies as readPolicies,
  roles as readRoles,
  tablesIn,
} from '@platform/data'
import {
  dropPolicyStatement,
  literal,
  type PolicyCommand,
  type PolicyDraft,
  policyChecks,
  policyCommands,
  policyReads,
  policyStatement,
  rowSecurityStatement,
} from '@platform/vocabulary'
import { describe, useLoad, useSession } from '../session.tsx'
import { Page, useWorkspace, WorkspaceSelect } from '../shell.tsx'
import { href } from '../url.ts'
import { Badge, Empty, Loading, Notice, Statement } from '../ui/bits.tsx'
import { Action, Button } from '../ui/button.tsx'
import { Checkbox, Field, Input, Select, TextArea } from '../ui/form.tsx'
import { EditIcon, PlusIcon, PolicyIcon, TrashIcon } from '../ui/icons.tsx'
import { Confirm, Drawer } from '../ui/overlay.tsx'
import { RoleInput, useLast, useOpening } from './grant-editor.tsx'
import { draftOf } from './model.ts'
import { useRunner } from './runner.tsx'

const isSystemRole = (name: string) => name.startsWith('pg_')

const commandWords: Record<PolicyCommand, string> = {
  ALL: 'Every statement',
  SELECT: 'Reading rows',
  INSERT: 'Adding rows',
  UPDATE: 'Changing rows',
  DELETE: 'Removing rows',
}

/** What row security does to a collection as it stands, in a sentence. */
export function rowSecurityWords(table: TableInfo, policies: number): string {
  const many = `${policies} ${policies === 1 ? 'policy' : 'policies'}`
  if (!table.rls)
    return policies
      ? `Row security is off: grants alone decide, and the ${many} below ${policies === 1 ? 'is' : 'are'} not applied until it is turned on.`
      : 'Row security is off: a role reaches every row its grants let it.'
  return policies
    ? 'Row security is on: a role reaches the rows a policy that applies to it allows, and no others.'
    : 'Row security is on with no policy: nobody but the owner reaches a row.'
}

/** One row policy, as the database records it. */
export function PolicyCard({
  policy,
  place,
  onEdit,
  onDrop,
}: {
  policy: PolicyInfo
  /** Says which collection the policy is on, where the list is not one collection's. */
  place?: boolean
  onEdit?: () => void
  onDrop?: () => void
}) {
  const everyone = policy.roles.length === 1 && policy.roles[0] === 'public'
  return (
    <li class="policy">
      <div class="policy-head">
        <strong class="mono">{policy.name}</strong>
        {place && (
          <a
            class="mono side-muted"
            href={href('/model/collection', { ws: policy.schema, c: policy.table, tab: 'access' })}
          >
            {policy.schema}.{policy.table}
          </a>
        )}
        <Badge title={commandWords[policy.command as PolicyCommand]}>{policy.command}</Badge>
        <Badge tone={policy.permissive === 'PERMISSIVE' ? 'neutral' : 'warning'}>
          {policy.permissive.toLowerCase()}
        </Badge>
        <span class="policy-roles">
          to <span class="mono">{everyone ? 'PUBLIC' : policy.roles.join(', ')}</span>
        </span>
        {(onEdit || onDrop) && (
          <span class="policy-actions">
            {onEdit && (
              <button
                type="button"
                class="icon-button"
                aria-label={`Change ${policy.name}`}
                title="Change policy"
                onClick={onEdit}
              >
                <EditIcon size={15} />
              </button>
            )}
            {onDrop && (
              <button
                type="button"
                class="icon-button"
                aria-label={`Drop ${policy.name}`}
                title="Drop policy"
                onClick={onDrop}
              >
                <TrashIcon size={15} />
              </button>
            )}
          </span>
        )}
      </div>
      {policy.using && <code class="policy-expr">USING ({policy.using})</code>}
      {policy.check && <code class="policy-expr">WITH CHECK ({policy.check})</code>}
    </li>
  )
}

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
export function PolicyDrawer({
  schema,
  target,
  roles,
  onClose,
  onDone,
}: {
  schema: string
  /** Null while the drawer is closed. */
  target: PolicyTarget | null
  roles: RoleInfo[]
  onClose: () => void
  onDone: () => void
}) {
  const opening = useOpening(target !== null)
  const last = useLast(target)
  return (
    <PolicyEditor
      key={opening}
      open={target !== null}
      schema={schema}
      target={last ?? { table: '' }}
      roles={roles}
      onClose={onClose}
      onDone={onDone}
    />
  )
}

function PolicyEditor({
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
  let statements: string[] = []
  let invalid: string | null = null
  try {
    const create = policyStatement(draft, { requireExpression: true })
    statements = original
      ? [dropPolicyStatement(schema, original.table, original.name), create]
      : [create]
  } catch (error) {
    invalid = error instanceof Error ? error.message : String(error)
  }
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
  const offered = [
    ...roles.filter((r) => !isSystemRole(r.name)).map((r) => r.name),
    ...draft.roles.filter((name) => !roles.some((r) => r.name === name)),
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
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
      {table && !table.rls && (
        <Notice tone="warning" title={`Row security is off on ${draft.table}`}>
          The database keeps the policy and applies none of it until row security is turned on.
        </Notice>
      )}
      <div class="form">
        <Field label="Collection" id="pol-table" required>
          <Select
            id="pol-table"
            value={draft.table}
            disabled={Boolean(original)}
            onChange={(e) => set({ table: e.currentTarget.value })}
          >
            {owned.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" id="pol-name" required>
          <Input
            id="pol-name"
            mono
            value={draft.name}
            onInput={(e) => set({ name: e.currentTarget.value })}
            placeholder="own_rows"
          />
        </Field>
        <Field label="For" id="pol-cmd" hint="The statements the policy is added to.">
          <Select
            id="pol-cmd"
            value={draft.command}
            onChange={(e) => set({ command: e.currentTarget.value as PolicyCommand })}
          >
            {policyCommands.map((c) => (
              <option key={c} value={c}>
                {commandWords[c]} ({c})
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Combines"
          id="pol-perm"
          hint="Permissive policies widen what a role reaches; restrictive ones narrow what the permissive ones allow."
        >
          <Select
            id="pol-perm"
            value={draft.permissive ? 'p' : 'r'}
            onChange={(e) => set({ permissive: e.currentTarget.value === 'p' })}
          >
            <option value="p">Permissive (OR)</option>
            <option value="r">Restrictive (AND)</option>
          </Select>
        </Field>
        <fieldset class="field field-wide">
          <legend class="field-label">Applies to</legend>
          <p class="field-hint">
            {draft.roles.length
              ? 'The roles named, and every role that inherits from them.'
              : 'No role chosen: the policy applies to everyone (PUBLIC).'}
          </p>
          <div class="checks checks-columns">
            {offered.map((name) => (
              <Checkbox
                key={name}
                label={<span class="mono">{name}</span>}
                checked={draft.roles.includes(name)}
                onChange={(on) => toggleRole(name, on)}
              />
            ))}
          </div>
          <div class="input-row">
            <RoleInput
              id="pol-role"
              value={other}
              roles={[]}
              placeholder="A role you cannot see, by name"
              onChange={setOther}
            />
            <Button
              icon={<PlusIcon size={16} />}
              disabled={!other.trim() || draft.roles.includes(other.trim())}
              onClick={() => {
                toggleRole(other.trim(), true)
                setOther('')
              }}
            >
              Add
            </Button>
          </div>
        </fieldset>
        {reads && (
          <Field
            label="USING"
            id="pol-using"
            wide
            hint="Which existing rows the roles reach: true for a row they do, false or null for one they do not."
          >
            <TextArea
              id="pol-using"
              mono
              rows={2}
              value={draft.using}
              onInput={(e) => set({ using: e.currentTarget.value })}
            />
            <Starts starts={starts} onChoose={(expression) => set({ using: expression })} />
          </Field>
        )}
        {checks && (
          <Field
            label="WITH CHECK"
            id="pol-check"
            wide
            hint={
              reads
                ? 'Which new or changed rows are allowed. Left empty, the database holds them to USING.'
                : 'Which new rows are allowed.'
            }
          >
            <TextArea
              id="pol-check"
              mono
              rows={2}
              value={draft.check}
              onInput={(e) => set({ check: e.currentTarget.value })}
            />
            <Starts starts={starts} onChoose={(expression) => set({ check: expression })} />
          </Field>
        )}
      </div>
      {invalid ? (
        <Notice tone="warning" title={invalid} />
      ) : (
        <Statement sql={statements.join('\n')} label="Runs as you, in one transaction" />
      )}
    </Drawer>
  )
}

/** Expressions to start a clause from. */
function Starts({
  starts,
  onChoose,
}: {
  starts: { label: string; expression: string }[]
  onChoose: (expression: string) => void
}) {
  return (
    <p class="starts">
      <span>Start from</span>
      {starts.map((start) => (
        <button
          key={start.expression}
          type="button"
          class="start"
          title={start.expression}
          onClick={() => onChoose(start.expression)}
        >
          {start.label}
        </button>
      ))}
    </p>
  )
}

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
      {runner.problem && (
        <Notice tone="danger" title={runner.problem.title}>
          {runner.problem.detail}
        </Notice>
      )}
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

/** The row policies of the workspace in view, collection by collection. */
export function Policies() {
  const { catalog } = useSession()
  const location = useLocation()
  const ws = useWorkspace()
  const only = location.query.c
  const found = useLoad((db) => readPolicies(db), [catalog])
  const roles = useLoad((db) => readRoles(db), [])
  const [creating, setCreating] = useState<PolicyTarget | null>(null)
  const all = tablesIn(catalog, ws)
  const owned = all.filter((t) => t.can_alter && t.kind !== 'v')
  const tables = all.filter((t) => !only || t.name === only)
  const list = (found.data ?? []).filter((p) => p.schema === ws)
  return (
    <Page
      title="Row policies"
      icon={<PolicyIcon size={22} />}
      crumbs={[{ label: 'Access', href: href('/access') }]}
      subtitle="Which rows each role reaches. A grant says what a role may do with a collection; a policy says to which of its rows."
      actions={
        owned.length ? (
          <Action
            label="New policy"
            icon={<PlusIcon size={22} />}
            onClick={() =>
              setCreating({ table: owned.find((t) => t.name === only)?.name ?? owned[0]!.name })
            }
          />
        ) : undefined
      }
      toolbar={
        <>
          <WorkspaceSelect path="/access/policies" />
          {only && (
            <a class="chip" href={href('/access/policies', { ws })}>
              Collection <span class="mono">{only}</span> · show every collection
            </a>
          )}
        </>
      }
    >
      {found.error ? (
        <Notice tone="danger" title={describe(found.error).title} />
      ) : !found.data ? (
        <Loading />
      ) : (
        tables.map((t) => (
          <CollectionPolicies
            key={t.name}
            schema={ws}
            table={t}
            policies={list.filter((p) => p.table === t.name)}
            roles={roles.data?.roles ?? []}
            heading={
              <a class="mono" href={href('/model/collection', { ws, c: t.name, tab: 'access' })}>
                {t.name}
              </a>
            }
            onDone={found.reload}
          />
        ))
      )}
      {found.data && !tables.length && (
        <Empty icon={<PolicyIcon size={26} />} title="No collection here you may reach" />
      )}
      <PolicyDrawer
        schema={ws}
        target={creating}
        roles={roles.data?.roles ?? []}
        onClose={() => setCreating(null)}
        onDone={found.reload}
      />
    </Page>
  )
}
