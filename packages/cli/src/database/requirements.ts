import type pg from 'pg'

/** A question only some roles may ask: refused, it is left unanswered and not a failure. */
const refused = (error: unknown) => (error as { code?: string }).code === '42501'

/** OAuth logins exist from PostgreSQL 18; nothing older can enforce how people sign in here. */
export async function requirePostgres18(q: pg.Client) {
  const found = await q.query("SELECT current_setting('server_version_num')::int AS n")
  if (found.rows[0].n < 180000)
    throw new Error(
      `PostgreSQL 18 or newer is required; this server reports ${Math.floor(found.rows[0].n / 10000)}`
    )
}
/**
 * What is wrong with how this server lets people in over the network. A token is the only
 * way in: a rule that accepts anything else, for anyone, is a problem. Reading the rules needs
 * a superuser or pg_read_all_settings; without that the answer is `unchecked`.
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
    else if (!['oauth', 'reject'].includes(r.auth_method))
      problems.push(
        `${where}: ${r.type} ${r.user_name.join(',')} ${r.auth_method} lets logins in without a token`
      )
  }
  return problems
}

/** The trigger that writes a row's revisions, whatever it has been named. */
const auditTrigger = `NOT t.tgisinternal AND t.tgfoid = to_regprocedure('platform.record_change()')
  AND (t.tgtype & 28) <> 0`

/** The schemas that hold an installation's own collections: not PostgreSQL's, not the platform's. */
const ownSchemas = `n.nspname NOT IN ('platform','information_schema') AND n.nspname !~ '^pg_'`

/** The first few of a list, and how many more there are. */
const some = (names: string[], most = 10) =>
  names.length > most
    ? `${names.slice(0, most).join(', ')} and ${names.length - most} more`
    : names.join(', ')

/**
 * What an operator should know about how this server stands, and has decided for themselves:
 * none of it is a failure. Each is a boundary the platform leaves to PostgreSQL and to the
 * deployment, said aloud so that it is a decision and not an accident:
 *
 *   - whether a token reaches the server in TLS;
 *   - whether every connection reads the role catalogs (`harden` hides them);
 *   - which collections are owned by a person, who is then not held to their row security
 *     and may switch their audit triggers off;
 *   - which tables write no revisions.
 *
 * A question the caller may not ask is left out, and said so.
 */
export async function postureNotes(q: pg.Client): Promise<string[]> {
  const notes: string[] = []
  const unasked: string[] = []
  const ask = async <Row>(what: string, text: string): Promise<Row[]> => {
    try {
      return (await q.query(text)).rows as Row[]
    } catch (error) {
      if (!refused(error)) throw error
      unasked.push(what)
      return []
    }
  }

  const ssl = await ask<{ ssl: string }>('TLS', "SELECT current_setting('ssl') AS ssl")
  if (ssl[0] && ssl[0].ssl !== 'on')
    notes.push(
      'TLS is off on this server: every token reaches it in the clear. That is for a server on the same machine or a network you would trust with a token.'
    )
  const open = await ask<{ rule_number: number }>(
    'the authentication rules',
    `SELECT rule_number FROM pg_hba_file_rules
      WHERE type = 'host' AND auth_method = 'oauth' AND error IS NULL ORDER BY rule_number`
  )
  if (open.length)
    notes.push(
      `pg_hba.conf rule ${open.map((r) => r.rule_number).join(', ')}: host takes a token with or without TLS. hostssl (PLATFORM_HBA_HOST=hostssl) refuses one sent in the clear.`
    )

  const catalogs = await ask<{ open: boolean }>(
    'the role catalogs',
    "SELECT has_table_privilege('public', 'pg_catalog.pg_auth_members', 'SELECT') AS open"
  )
  if (catalogs[0]?.open)
    notes.push(
      'Every connection reads the role catalogs: who belongs to which group. `harden` hides them from ordinary connections.'
    )

  const owned = await ask<{ name: string; owner: string }>(
    'who owns the collections',
    `SELECT format('%I.%I', n.nspname, c.relname) AS name, r.rolname::text AS owner
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_roles r ON r.oid = c.relowner
      WHERE c.relkind IN ('r','p') AND ${ownSchemas} AND r.rolcanlogin AND NOT r.rolsuper
      ORDER BY 1`
  )
  if (owned.length)
    notes.push(
      `Owned by a person, who is not held to its row security and may disable its audit triggers: ${some(owned.map((t) => `${t.name} (${t.owner})`))}. A NOLOGIN group that owns a collection owns it for its members, and can be taken from one of them.`
    )

  const silent = await ask<{ name: string; disabled: boolean }>(
    'the audit triggers',
    `SELECT format('%I.%I', n.nspname, c.relname) AS name,
            EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND ${auditTrigger}) AS disabled
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','p') AND ${ownSchemas}
        AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND ${auditTrigger}
                           AND t.tgenabled IN ('O','A'))
      ORDER BY 1`
  )
  const missing = silent.filter((t) => !t.disabled).map((t) => t.name)
  const disabled = silent.filter((t) => t.disabled).map((t) => t.name)
  if (missing.length)
    notes.push(
      `No audit trigger, so writes leave no revision: ${some(missing)}. Collections made by platform.create_collection carry one; a table made by hand needs its owner to add it.`
    )
  if (disabled.length)
    notes.push(`The audit trigger is disabled, so writes leave no revision: ${some(disabled)}.`)

  if (unasked.length)
    notes.push(
      `Not checked, for want of the right to read them: ${unasked.join(', ')}. Run doctor as a superuser to check them.`
    )
  return notes
}
