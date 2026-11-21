import { ident, qualified } from '../core.ts'
import { InvalidName } from '../errors.ts'
import { grantee } from './privileges.ts'

export type PolicyCommand = 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

/** The commands a row policy may be written for. */
export const policyCommands: PolicyCommand[] = ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE']

export interface PolicyDraft {
  schema: string
  table: string
  name: string
  permissive: boolean
  command: PolicyCommand
  roles: string[]
  using: string
  check: string
}

/** A policy for INSERT carries no USING: there is no old row to read. */
export const policyReads = (command: PolicyCommand): boolean => command !== 'INSERT'

/** A policy for SELECT or DELETE carries no WITH CHECK: no row is written. */
export const policyChecks = (command: PolicyCommand): boolean =>
  command !== 'SELECT' && command !== 'DELETE'

/**
 * A row policy. PostgreSQL decides which clause a policy may carry: one for INSERT has only
 * a WITH CHECK, one for SELECT or DELETE has only a USING, and one for UPDATE or ALL has
 * both. A policy with neither covers every row, which is what PostgreSQL writes by default.
 *
 * A policy a reader writes must say something about the rows it reaches: `requireExpression`
 * refuses a policy that has neither a USING nor a WITH CHECK. The operator's tools may write
 * one that only says who it is for, so they do not ask for it.
 */
/**
 * Refuses a policy expression that would not stay inside its parentheses. The expression is
 * PostgreSQL's to judge, and it is written into the statement as it is: so it must be one
 * expression, which ends where the statement expects it to. A parenthesis that closes what
 * it did not open, a semicolon, or a quotation or comment left open would end the clause
 * early and let what follows be read as a statement of its own.
 */
export function policyExpression(expression: string, clause: string): string {
  const text = expression.trim()
  const refuse = (why: string) => new InvalidName(`The ${clause} expression ${why}`)
  let depth = 0
  let at = 0
  /** Steps over what is quoted, to the character after the closing quotation. */
  const quoted = (close: string, escapes: boolean) => {
    for (at += 1; at < text.length; at++) {
      if (escapes && text[at] === '\\') at++
      else if (text.startsWith(close, at)) {
        // A quotation mark written twice is the mark itself, not the end.
        if (close.length === 1 && text[at + 1] === close) at++
        else {
          at += close.length
          return
        }
      }
    }
    throw refuse('leaves a quotation open')
  }
  while (at < text.length) {
    const char = text[at]
    const dollar =
      char === '$' ? /^\$([A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$/.exec(text.slice(at)) : null
    if (char === "'")
      quoted("'", at > 0 && /[eE]/.test(text[at - 1] ?? '') && !/\w/.test(text[at - 2] ?? ''))
    else if (char === '"') quoted('"', false)
    else if (dollar && !/[\w$]/.test(text[at - 1] ?? '')) {
      at += dollar[0].length - 1
      quoted(dollar[0], false)
    } else if (text.startsWith('--', at) || text.startsWith('/*', at))
      throw refuse('may not hold a comment')
    else if (char === ';') throw refuse('may not hold a semicolon')
    else {
      if (char === '(') depth++
      if (char === ')' && --depth < 0) throw refuse('closes a parenthesis it did not open')
      at++
    }
  }
  if (depth > 0) throw refuse('leaves a parenthesis open')
  return text
}

export function policyStatement(
  draft: PolicyDraft,
  options?: { requireExpression?: boolean }
): string {
  if (!draft.name.trim()) throw new InvalidName('Name the policy')
  if (options?.requireExpression && !draft.using.trim() && !draft.check.trim())
    throw new InvalidName('A policy needs a USING or a WITH CHECK expression')
  const roles = draft.roles.length ? draft.roles.map(grantee).join(', ') : 'PUBLIC'
  const lines = [
    `CREATE POLICY ${ident(draft.name.trim())} ON ${qualified(draft.schema, draft.table)}`,
    `  AS ${draft.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${draft.command} TO ${roles}`,
  ]
  const reads = policyReads(draft.command)
  const checks = policyChecks(draft.command)
  if (!reads && draft.using.trim())
    throw new InvalidName(
      `A policy for ${draft.command} cannot have a USING expression: there is no old row.`
    )
  if (!checks && draft.check.trim())
    throw new InvalidName(
      `A policy for ${draft.command} cannot have a WITH CHECK expression: no row is written.`
    )
  if (reads && draft.using.trim()) lines.push(`  USING (${policyExpression(draft.using, 'USING')})`)
  if (checks && draft.check.trim())
    lines.push(`  WITH CHECK (${policyExpression(draft.check, 'WITH CHECK')})`)
  return `${lines.join('\n')};`
}
