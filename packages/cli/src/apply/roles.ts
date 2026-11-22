import { createRoleStatement, ident } from '@platform/vocabulary'
import type { Run } from './run.ts'
import { reserved, type Group, type User } from './schema.ts'

/** A user is a role and nothing else: who may claim it is the identity provider's business. */
export async function applyUser(run: Run, user: User, database: string): Promise<void> {
  const q = run.q
  const role = ident(user.name)
  const found = await run.role(user.name)
  if (!found) {
    await q.query(createRoleStatement({ name: user.name, login: user.login }))
    run.changed(`create user ${user.name}`)
  } else if (found.login !== user.login) {
    // fallow-ignore-next-line security-sink -- the role name is quoted with ident(); the manifest is the operator's own
    await q.query(`ALTER ROLE ${role} ${user.login ? 'LOGIN' : 'NOLOGIN'}`)
    run.changed(`${user.login ? 'enable' : 'disable'} login of ${user.name}`)
  } else run.same()
  // A session's own settings are the session's to change, statement_timeout among them;
  // how many sessions a role may hold is not. PostgreSQL counts them itself.
  if (user.connections !== undefined) {
    const held = found ? found.connection_limit : -1
    if (held === user.connections) run.same()
    else {
      // fallow-ignore-next-line security-sink -- the role name is quoted with ident(); the limit is a number the manifest gives
      await q.query(`ALTER ROLE ${role} CONNECTION LIMIT ${user.connections}`)
      run.changed(
        user.connections < 0
          ? `lift the connection limit of ${user.name}`
          : `limit ${user.name} to ${user.connections} connections`
      )
    }
  }
  // Membership of platform_users is what lets a login connect to this database at all.
  for (const group of ['platform_users', ...user.groups]) await run.member(user.name, group)
  for (const group of user.admits) await run.admits(user.name, group)
  if (user.admin === undefined) return
  const rights = await q.query(
    `SELECT a.create_role AS roles, has_database_privilege(a.name, current_database(), 'CREATE') AS creates,
        platform.has_admin_option(a.name) AS admits
        FROM platform.role_attributes($1) a`,
    [user.name]
  )
  const held = rights.rows[0] ?? { roles: false, creates: false, admits: false }
  if (Object.values(held).every((value) => value === user.admin)) {
    run.same()
  } else if (user.admin) {
    // fallow-ignore-next-line security-sink -- the role name is quoted with ident(); the manifest is the operator's own
    await q.query(`ALTER ROLE ${role} CREATEROLE`)
    // fallow-ignore-next-line security-sink -- the role name is quoted with ident(); the manifest is the operator's own
    await q.query(`GRANT platform_users TO ${role} WITH ADMIN OPTION`)
    // fallow-ignore-next-line security-sink -- the role and the database are quoted with ident(); the manifest is the operator's own
    await q.query(`GRANT CREATE ON DATABASE ${database} TO ${role}`)
    run.changed(`make ${user.name} an administrator`)
  } else {
    // fallow-ignore-next-line security-sink -- the role name is quoted with ident(); the manifest is the operator's own
    await q.query(`ALTER ROLE ${role} NOCREATEROLE`)
    // fallow-ignore-next-line security-sink -- the role name is quoted with ident(); the manifest is the operator's own
    await q.query(`REVOKE ADMIN OPTION FOR platform_users FROM ${role}`)
    // fallow-ignore-next-line security-sink -- the role and the database are quoted with ident(); the manifest is the operator's own
    await q.query(`REVOKE CREATE ON DATABASE ${database} FROM ${role}`)
    run.changed(`withdraw administration from ${user.name}`)
  }
  // Administrators read the role catalogs, so that they can administer roles and run the
  // operator's own psql session. Ordinary members never do. The group exists from 2.0.1 on.
  const admins = (await q.query("SELECT to_regrole('platform_admins') AS group")).rows[0]?.group
  if (!admins) return
  if (user.admin) await run.member(user.name, 'platform_admins', true)
  else {
    // fallow-ignore-next-line security-sink -- the role name is quoted with ident(); the manifest is the operator's own
    await q.query(`REVOKE platform_admins FROM ${role}`)
  }
}

/** A group is a role that does not log in. */
export async function applyGroup(run: Run, group: Group): Promise<void> {
  const found = await run.role(group.name)
  if (found?.login) throw new Error(`${group.name} is a login, not a group`)
  if (found) return run.same()
  await run.q.query(createRoleStatement({ name: group.name, login: false }))
  run.changed(`create group ${group.name}`)
}

/** Dropping is PostgreSQL's decision: a role that still owns or is granted anything stays. */
export async function dropRole(run: Run, kind: string, role: string): Promise<void> {
  if (reserved(role)) throw new Error(`${role} is a reserved role and is not managed here`)
  try {
    // fallow-ignore-next-line security-sink -- the role name is quoted with ident(); the manifest is the operator's own
    await run.q.query(`DROP ROLE ${ident(role)}`)
  } catch (error) {
    // A role that is not there is already in the state the manifest asks for.
    if ((error as { code?: string }).code === '42704') return run.same()
    throw error
  }
  run.changed(`drop ${kind} ${role}`)
}
