import type { PolicyInfo } from '@platform/data'
import { type PolicyCommand, type PolicyDraft, policyCommands } from '@platform/vocabulary'

/**
 * A row policy, as the access pages read it: the database's own record, turned back into the
 * draft the editor starts from, and the question of which roles it applies to.
 */

/** A policy as the editor starts from it: the database's own record, turned back into a draft. */
export function draftOf(policy: PolicyInfo): PolicyDraft {
  const command = policyCommands.includes(policy.command as PolicyCommand)
    ? (policy.command as PolicyCommand)
    : 'ALL'
  return {
    schema: policy.schema,
    table: policy.table,
    name: policy.name,
    permissive: policy.permissive === 'PERMISSIVE',
    command,
    roles: policy.roles.filter((role) => role !== 'public'),
    using: policy.using ?? '',
    check: policy.check ?? '',
  }
}

/** Does a policy apply to a role: by its name, through a group it inherits from, or as PUBLIC? */
export const policyReaches = (policy: PolicyInfo, role: string, groups: string[]): boolean =>
  policy.roles.some((named) => named === 'public' || named === role || groups.includes(named))
