import type pg from 'pg'

/** OAuth logins exist from PostgreSQL 18; nothing older can enforce how people sign in here. */
export async function requirePostgres18(q: pg.Client) {
  const found = await q.query("SELECT current_setting('server_version_num')::int AS n")
  if (found.rows[0].n < 180000)
    throw new Error(
      `PostgreSQL 18 or newer is required; this server reports ${Math.floor(found.rows[0].n / 10000)}`
    )
}
/**
 * What is wrong with how this server lets people in over the network. Tokens are the rule:
 * a password may remain only on a rule that names its logins, such as the installer's
 * administrator. Reading the rules needs a superuser or pg_read_all_settings; without that
 * the answer is `unchecked`.
 */
export async function authenticationProblems(q: pg.Client): Promise<string[] | 'unchecked'> {
  let rules: {
    rule_number: number
    type: string
    user_name: string[]
    auth_method: string
    error: string | null
  }[]
  try {
    rules = (
      await q.query(`SELECT rule_number,type,user_name,auth_method,error FROM pg_hba_file_rules
        WHERE type IS DISTINCT FROM 'local' ORDER BY rule_number`)
    ).rows
  } catch (error) {
    if ((error as { code?: string }).code === '42501') return 'unchecked'
    throw error
  }
  const problems: string[] = []
  const libraries = await q.query("SELECT current_setting('oauth_validator_libraries') AS v")
  if (!libraries.rows[0].v) problems.push('oauth_validator_libraries is empty: no token validator')
  if (!rules.some((r) => r.auth_method === 'oauth'))
    problems.push('pg_hba.conf has no oauth rule: nobody can sign in with a token')
  for (const r of rules) {
    const where = `pg_hba.conf rule ${r.rule_number}`
    if (r.error) problems.push(`${where}: ${r.error}`)
    else if (['oauth', 'reject'].includes(r.auth_method)) continue
    // A group (+name), a regular expression or all would open a second way in for ordinary users.
    else if (r.auth_method !== 'scram-sha-256' || r.user_name.some((u) => /^(all$|\+|\/)/.test(u)))
      problems.push(
        `${where}: ${r.type} ${r.user_name.join(',')} ${r.auth_method} lets logins in without a token`
      )
  }
  return problems
}
