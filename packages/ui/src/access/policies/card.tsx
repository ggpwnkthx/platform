import type { PolicyInfo, TableInfo } from '@platform/data'
import type { PolicyCommand } from '@platform/vocabulary'
import { href } from '../../url.ts'
import { Badge } from '../../ui/bits.tsx'
import { EditIcon, TrashIcon } from '../../ui/icons.tsx'

export const commandWords: Record<PolicyCommand, string> = {
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
