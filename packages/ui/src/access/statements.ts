import { InvalidName, type PolicyDraft, policyStatement as writePolicy } from '@platform/sql'

/**
 * Access, written as the statements PostgreSQL runs. A grant, a row policy, a membership and
 * a role are all shown to the reader before they run, and then run as the reader, in one
 * transaction. PostgreSQL decides whether the reader may.
 *
 * The statements themselves are the platform's own, written once for the operator's tools
 * and the interface alike; what is left here is the rule the interface adds: a policy the
 * reader writes must say something about the rows it reaches.
 */

/** A policy the reader may write: it needs a USING or a WITH CHECK expression. */
export function policyStatement(draft: PolicyDraft): string {
  if (!draft.using.trim() && !draft.check.trim())
    throw new InvalidName('A policy needs a USING or a WITH CHECK expression')
  return writePolicy(draft)
}
