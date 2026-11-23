import { Group, Select, Switch, TagsInput, Textarea, TextInput } from '@mantine/core'
import {
  type PolicyCommand,
  type PolicyDraft,
  dropPolicyStatement,
  policyChecks,
  policyCommands,
  policyReads,
  policyStatement,
} from '@platform/core'
import { Change } from '../bits/change.tsx'
import { useRoles } from './shared.tsx'

/**
 * The editor of a row policy: what it is for, who it applies to, and the expressions that
 * decide which rows it reaches. PostgreSQL alters a policy's roles and expressions in place
 * but not what it is for: a changed policy is dropped and made again, in the one transaction
 * every change runs in.
 */
export function PolicyEditor({
  schema,
  editing,
  onChange,
  onClose,
}: {
  schema: string
  editing: { draft: PolicyDraft; was?: string } | null
  onChange(editing: { draft: PolicyDraft; was?: string } | null): void
  onClose(): void
}) {
  const known = useRoles()
  const draft = editing?.draft
  const set = (changes: Partial<PolicyDraft>) =>
    editing && onChange({ ...editing, draft: { ...editing.draft, ...changes } })
  if (!draft || !editing) return null
  return (
    <Change
      title={editing.was ? `Policy ${editing.was}` : `New policy on ${draft.table}`}
      opened
      onClose={onClose}
      statements={() => {
        if (!draft.using.trim() && !draft.check.trim())
          throw new Error('A policy needs a USING or a WITH CHECK expression.')
        return [
          ...(editing.was ? [dropPolicyStatement(schema, draft.table, editing.was)] : []),
          policyStatement(draft),
        ]
      }}
    >
      <TextInput
        label="Name"
        className="mono"
        value={draft.name}
        onChange={(e) => set({ name: e.currentTarget.value })}
      />
      <Group grow>
        <Select
          label="For"
          allowDeselect={false}
          data={[...policyCommands]}
          value={draft.command}
          onChange={(command) => set({ command: command as PolicyCommand })}
        />
        <Switch
          label="Restrictive: narrows what other policies allow"
          checked={!draft.permissive}
          onChange={(e) => set({ permissive: !e.currentTarget.checked })}
          mt="lg"
        />
      </Group>
      <TagsInput
        label="Applies to"
        description="No role means PUBLIC: everyone."
        className="mono"
        data={[...(known.data?.roles ?? []).map((r) => r.name), 'public']}
        value={draft.roles}
        onChange={(roles) => set({ roles })}
      />
      {policyReads(draft.command) && (
        <Textarea
          label="USING"
          description="The rows the role may see or change"
          className="mono"
          autosize
          minRows={2}
          value={draft.using}
          onChange={(e) => set({ using: e.currentTarget.value })}
          placeholder="created_by = session_user"
        />
      )}
      {policyChecks(draft.command) && (
        <Textarea
          label="WITH CHECK"
          description="The rows the role may write"
          className="mono"
          autosize
          minRows={2}
          value={draft.check}
          onChange={(e) => set({ check: e.currentTarget.value })}
        />
      )}
    </Change>
  )
}
