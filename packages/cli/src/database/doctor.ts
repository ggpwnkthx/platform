import { type Db, ident } from '@platform/core'

export const refused = (error: unknown) => (error as { code?: string }).code === '42501'
export const rows = async <Row>(db: Db, text: string, params?: unknown[]) =>
  (await db.query<Row>(text, params)).rows
const some = (names: string[]) =>
  names.length > 10
    ? `${names.slice(0, 10).join(', ')} and ${names.length - 10} more`
    : names.join(', ')
const auditTrigger = `NOT t.tgisinternal AND t.tgfoid = to_regprocedure('platform.record_change()') AND (t.tgtype & 28) <> 0`
const ownSchemas = `n.nspname NOT IN ('platform','information_schema') AND n.nspname !~ '^pg_'`

/** The server version, how it lets people in, the installation, and what the deployment has left open. */
export async function doctor(db: Db, say: (line: string) => void): Promise<boolean> {
  say(
    JSON.stringify(
      (
        await rows(
          db,
          `SELECT session_user, current_user, current_database(), current_setting('server_version') AS postgresql, (SELECT version FROM platform.installation) AS platform`
        )
      )[0]
    )
  )
  const problems: string[] = []
  const rules = await rows<{
    rule_number: number
    type: string
    user_name: string[]
    auth_method: string
    error: string | null
  }>(
    db,
    `SELECT rule_number,type,user_name,auth_method,error FROM pg_hba_file_rules WHERE type IS DISTINCT FROM 'local' ORDER BY rule_number`
  ).catch((error) => (refused(error) ? null : Promise.reject(error)))
  if (!rules)
    say('Authentication rules not checked: that needs a superuser or pg_read_all_settings.')
  else {
    if (
      !(
        await rows<{ v: string }>(
          db,
          "SELECT current_setting('oauth_validator_libraries', true) AS v"
        )
      )[0]?.v
    )
      problems.push('oauth_validator_libraries is empty: no token validator')
    if (!rules.some((r) => r.auth_method === 'oauth'))
      problems.push('pg_hba.conf has no oauth rule: nobody can sign in with a token')
    for (const r of rules)
      if (r.error) problems.push(`pg_hba.conf rule ${r.rule_number}: ${r.error}`)
      else if (!['oauth', 'reject'].includes(r.auth_method))
        problems.push(
          `pg_hba.conf rule ${r.rule_number}: ${r.type} ${r.user_name.join(',')} ${r.auth_method} lets logins in without a token`
        )
    if (!problems.length) say('Authentication rules: network logins are by token.')
  }
  const unasked: string[] = []
  const ask = <Row>(what: string, text: string) =>
    rows<Row>(db, text).catch((error) => {
      if (!refused(error)) throw error
      unasked.push(what)
      return [] as Row[]
    })
  const note = (text: string) => say(`Note: ${text}`)
  if ((await ask<{ ssl: string }>('TLS', "SELECT current_setting('ssl') AS ssl"))[0]?.ssl === 'off')
    note(
      'TLS is off on this server: every token reaches it in the clear. That is for a server on the same machine or a network you would trust with a token.'
    )
  if (
    (
      await ask<{ open: boolean }>(
        'the role catalogs',
        "SELECT has_table_privilege('public', 'pg_catalog.pg_auth_members', 'SELECT') AS open"
      )
    )[0]?.open
  )
    problems.push(
      'Every connection reads the role catalogs: who belongs to which group. `harden` hides them from ordinary connections.'
    )
  const guarded = await ask<{ on: number }>(
    'the guard on row security',
    "SELECT count(*)::int AS on FROM pg_event_trigger WHERE evtname IN ('platform_guard_ddl','platform_guard_drop')"
  )
  if (!guarded[0]?.on)
    problems.push(
      'No guard on row security: `harden --events` refuses the DDL that would turn a collection out of row security, or drop the triggers that write its history.'
    )
  const owned = await ask<{ name: string }>(
    'who owns the collections',
    `SELECT format('%I.%I (%s)', n.nspname, c.relname, r.rolname) AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner
    WHERE c.relkind IN ('r','p') AND ${ownSchemas} AND r.rolcanlogin AND NOT r.rolsuper ORDER BY 1`
  )
  if (owned.length)
    note(
      `Owned by a person, who is not held to its row security: ${some(owned.map((t) => t.name))}. With the guard installed, an owner may not turn that row security off, nor drop the audit triggers. A NOLOGIN group that owns a collection owns it for its members.`
    )
  const silent = await ask<{ name: string }>(
    'the audit triggers',
    `SELECT format('%I.%I', n.nspname, c.relname) AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p') AND ${ownSchemas}
     AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = c.oid AND ${auditTrigger} AND t.tgenabled IN ('O','A')) ORDER BY 1`
  )
  if (silent.length)
    note(
      `No enabled audit trigger, so writes leave no revision: ${some(silent.map((t) => t.name))}. Collections made by platform.create_collection carry one.`
    )
  if (unasked.length)
    note(
      `Not checked, for want of the right to read them: ${unasked.join(', ')}. Run doctor as a superuser to check them.`
    )
  for (const problem of problems) say(problem)
  return !problems.length
}

/** Takes a role's login away and ends its sessions, or gives the login back. */
export async function setLogin(
  db: Db,
  command: 'lock' | 'unlock',
  name: string
): Promise<string[]> {
  const role = (
    await rows<{ login: boolean; self: boolean; server: boolean }>(
      db,
      `SELECT a.login, $1 = session_user AS self, to_regrole(quote_ident($1))::oid = 10 AS server FROM platform.role_attributes($1) a`,
      [name]
    )
  )[0]
  if (!role) throw new Error(`There is no role ${name} here, or it is not yours to administer`)
  if (role.self) throw new Error(`${name} is the role this command is signed in as`)
  if (role.server) throw new Error(`${name} is the server's own superuser, and is left alone`)
  await db.query(`ALTER ROLE ${ident(name)} ${command === 'lock' ? 'NOLOGIN' : 'LOGIN'}`)
  if (command === 'unlock')
    return [
      role.login ? `${name} could already log in.` : `${name} may log in again, with a token.`,
    ]
  const said = [
    role.login
      ? `${name} can no longer log in, whatever token names it.`
      : `${name} already had no login.`,
  ]
  const ended = await rows<{ n: number }>(
    db,
    `WITH held AS MATERIALIZED (SELECT pid FROM pg_stat_activity WHERE usename = $1 AND pid <> pg_backend_pid())
    SELECT count(*) FILTER (WHERE pg_terminate_backend(pid))::int AS n FROM held`,
    [name]
  ).catch((error) => (refused(error) ? null : Promise.reject(error)))
  if (!ended) said.push('Its open sessions are not this role’s to end: they last until they close.')
  else if (ended[0]?.n) said.push(`Ended ${ended[0].n} of its open sessions.`)
  return said
}

const operators = 'platform_core, platform_admins'
/** PostgreSQL publishes its role catalogs to every connection; this hides them, or puts the default back. */
export const hardenSql = (mode: 'strict' | 'keep-names' | 'restore') =>
  mode === 'restore'
    ? 'GRANT SELECT ON pg_auth_members, pg_roles, pg_user TO PUBLIC;'
    : `-- pg_auth_members is a shared catalog: the rule reaches every database in this cluster.
REVOKE SELECT ON pg_auth_members FROM PUBLIC;
REVOKE SELECT ON pg_roles FROM PUBLIC;
REVOKE SELECT ON pg_user FROM PUBLIC;
${mode === 'keep-names' ? 'GRANT SELECT (oid, rolname) ON pg_roles TO PUBLIC;\nGRANT SELECT (usename, usesysid) ON pg_user TO PUBLIC;\n' : ''}-- The operators keep the whole catalog: they administer roles.
GRANT SELECT ON pg_auth_members, pg_roles, pg_user TO ${operators};`
