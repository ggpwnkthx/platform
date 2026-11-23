import type { User } from './schema.ts'
import type { Run } from './run.ts'
import { ident } from '../sql/kit.ts'
import { createRoleStatements, reservedRole } from '../sql/roles.ts'
export const notReserved = (role: string) => {
  if (reservedRole(role)) throw new Error(`${role} is a reserved role and is not managed here`)
}

interface RoleRow {
  login: boolean
  connection_limit: number
}
/** What PostgreSQL knows of a role, as the platform's own function says it. */
const roleAttributes = (run: Run, name: string) =>
  run.one<RoleRow>('SELECT * FROM platform.role_attributes($1)', [name])

/**
 * A role the manifest names: made if it is not there, and told what kind it is. What it
 * found is given back, so the caller may say more about the same role.
 */
async function ensureRole(run: Run, name: string, login: boolean, kind: string) {
  const found = await roleAttributes(run, name)
  if (!found) {
    await run.db.query(createRoleStatements({ name, login })[0]!)
    run.changed(`create ${kind} ${name}`)
    return found
  }
  if (found.login !== login) {
    await run.db.query(`ALTER ROLE ${ident(name)} ${login ? 'LOGIN' : 'NOLOGIN'}`)
    run.changed(`${login ? 'enable' : 'disable'} login of ${name}`)
  } else run.unchanged++
  return found
}

/** A group the manifest names: a role that cannot log in. */
export async function applyGroup(run: Run, name: string) {
  notReserved(name)
  const found = await roleAttributes(run, name)
  if (found?.login) throw new Error(`${name} is a login, not a group`)
  if (found) run.unchanged++
  else {
    await run.db.query(createRoleStatements({ name, login: false })[0]!)
    run.changed(`create group ${name}`)
  }
}

/** A person: a role that logs in, with the groups it belongs to and the ones it admits. */
export async function applyUser(run: Run, user: User, database: string) {
  notReserved(user.name)
  const role = ident(user.name)
  const found = await ensureRole(run, user.name, user.login, 'user')
  if (user.connections !== undefined) {
    if ((found?.connection_limit ?? -1) === user.connections) run.unchanged++
    else {
      await run.db.query(`ALTER ROLE ${role} CONNECTION LIMIT ${user.connections}`)
      run.changed(
        user.connections < 0
          ? `lift the connection limit of ${user.name}`
          : `limit ${user.name} to ${user.connections} connections`
      )
    }
  }
  for (const group of ['platform_users', ...user.groups]) await run.member(user.name, group)
  for (const group of user.admits) {
    notReserved(group)
    await run.member(user.name, group, true)
  }
  if (user.admin === undefined) return
  await applyAdmin(run, user, database, role)
}

/**
 * An administrator makes roles, admits people to the platform and makes workspaces. The
 * three rights are kept together, so an administrator never keeps one of them alone.
 */
async function applyAdmin(run: Run, user: User, database: string, role: string) {
  const held = (await run.one<Record<string, boolean>>(
    `SELECT a.create_role AS roles, has_database_privilege(a.name, current_database(), 'CREATE') AS creates,
            platform.has_admin_option(a.name) AS admits
       FROM platform.role_attributes($1) a`,
    [user.name]
  )) ?? { roles: false }
  if (Object.values(held).every((value) => value === user.admin)) run.unchanged++
  else {
    await run.all(
      user.admin
        ? [
            `ALTER ROLE ${role} CREATEROLE`,
            `GRANT platform_users TO ${role} WITH ADMIN OPTION`,
            `GRANT CREATE ON DATABASE ${database} TO ${role}`,
          ]
        : [
            `ALTER ROLE ${role} NOCREATEROLE`,
            `REVOKE ADMIN OPTION FOR platform_users FROM ${role}`,
            `REVOKE CREATE ON DATABASE ${database} FROM ${role}`,
          ]
    )
    run.changed(
      user.admin
        ? `make ${user.name} an administrator`
        : `withdraw administration from ${user.name}`
    )
  }
  if (user.admin) await run.member(user.name, 'platform_admins', true)
  else await run.db.query(`REVOKE platform_admins FROM ${role}`)
}

export async function dropRole(run: Run, kind: string, role: string) {
  notReserved(role)
  const found = await run.one<{ r: unknown }>('SELECT to_regrole(quote_ident($1)) AS r', [role])
  if (!found?.r) return void run.unchanged++
  await run.db.query(`DROP ROLE ${ident(role)}`)
  run.changed(`drop ${kind} ${role}`)
}
