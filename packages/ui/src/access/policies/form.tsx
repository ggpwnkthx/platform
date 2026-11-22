import type { PolicyCommand, PolicyDraft } from '@platform/vocabulary'
import { policyCommands } from '@platform/vocabulary'
import { Field, Input, Select, TextArea } from '../../ui/form.tsx'
import { commandWords } from './card.tsx'
import { PolicyRoles } from './roles.tsx'

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
 * The form a row policy is written with: what it is for, who it applies to, and the
 * expressions that decide which rows it reaches.
 */
export function PolicyForm({
  owned,
  draft,
  fixedTable,
  set,
  reads,
  checks,
  starts,
  offered,
  other,
  setOther,
  onToggleRole,
  onAddRole,
}: {
  owned: { name: string }[]
  draft: PolicyDraft
  /** Whether the collection is fixed: the database does not move a policy to another one. */
  fixedTable: boolean
  set: (changes: Partial<PolicyDraft>) => void
  /** Whether the policy is added to SELECT: it says which rows are reached. */
  reads: boolean
  /** Whether the policy is added to INSERT or UPDATE: it says which rows are allowed. */
  checks: boolean
  starts: { label: string; expression: string }[]
  offered: string[]
  other: string
  setOther: (name: string) => void
  onToggleRole: (name: string, on: boolean) => void
  onAddRole: () => void
}) {
  return (
    <div class="form">
      <Field label="Collection" id="pol-table" required>
        <Select
          id="pol-table"
          value={draft.table}
          disabled={fixedTable}
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
      <PolicyRoles
        offered={offered}
        chosen={draft.roles}
        other={other}
        setOther={setOther}
        onToggle={onToggleRole}
        onAdd={onAddRole}
      />
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
  )
}
