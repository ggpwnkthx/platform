/**
 * The scope of a statement (spec §3.10).
 *
 * The isolation of the tenants is enforced by the application: the keys
 * of the eight tables carry the tenant and every statement that reads a
 * tenant reads it by its id. The scope of this module is the **backstop**
 * of the database: a statement that runs in the scope of a tenant sees
 * the rows of that tenant and nothing else, even when it forgets the
 * condition in its text.
 *
 * The scope is the setting `access.scope`, and the tenant of the scope
 * is the setting `access.tenant_id`. Both are set with
 * `set_config(..., true)`, which is local to the transaction: a pooled
 * connection never carries the scope of another request.
 *
 * **The scope of a statement is always explicit.** There are three:
 *
 * - the scope of a tenant: `access.scope` is `tenant` and
 *   `access.tenant_id` names the tenant. The statement sees the rows of
 *   that tenant and nothing else.
 * - the scope of the platform: `access.scope` is `platform`. The
 *   statement sees every row of the platform. It is the scope of the
 *   registry of the tenants and of the operations of the operator of the
 *   platform, and it is asked for by name: a statement that may see
 *   every tenant says so.
 * - no scope at all: the statement sees **nothing**. A statement that
 *   was not given a scope is not a statement that sees everything: it is
 *   a statement that sees nothing, and the database refuses to let it
 *   read or write a row of a tenant.
 *
 * The third scope is the reason the scope is written down: the scope of
 * a statement is never the default, and a statement that forgot its
 * scope fails loudly instead of reading the platform.
 */

import type { SqlClient } from './database'
import type { Scope } from '../../domains/administration'

/** The setting that carries the kind of the scope of a statement. */
const SCOPE_SETTING = 'access.scope'

/** The setting that carries the tenant of the scope of a statement. */
const TENANT_SCOPE_SETTING = 'access.tenant_id'

/** The value of the scope of a statement that may touch every tenant. */
const PLATFORM_SCOPE = 'platform'

/** The value of the scope of a statement that may touch one tenant. */
const TENANT_SCOPE = 'tenant'

/**
 * Runs a statement in the scope of a tenant, or in the scope of the
 * platform.
 *
 * The scope is set inside the transaction of the statement: the setting
 * is local to the transaction, and the connection of the pool returns to
 * the pool without it.
 */
export async function withTenantScope<T>(
  db: SqlClient,
  tenantId: string | null,
  action: (client: SqlClient) => Promise<T>
): Promise<T> {
  if (tenantId === null) {
    return await withPlatformScope(db, action)
  }
  return await db.transaction(async (client) => {
    await client.query(`select set_config($1, $2, true), set_config($3, $4, true)`, [
      SCOPE_SETTING,
      TENANT_SCOPE,
      TENANT_SCOPE_SETTING,
      tenantId,
    ])
    return await action(client)
  })
}

/**
 * Runs a statement in the scope of the platform.
 *
 * The scope of the platform is the scope of the registry of the tenants
 * and of the operations of the operator of the platform. It is asked for
 * by name, and it is never the default: a statement that was not given a
 * scope sees nothing.
 */
export async function withPlatformScope<T>(
  db: SqlClient,
  action: (client: SqlClient) => Promise<T>
): Promise<T> {
  return await db.transaction(async (client) => {
    await client.query(`select set_config($1, $2, true)`, [SCOPE_SETTING, PLATFORM_SCOPE])
    return await action(client)
  })
}

/**
 * Runs a statement in the scope of the call.
 *
 * The scope of the call is the scope of the credential that caused it: a
 * credential of a tenant may only act for that tenant, and the statement
 * it causes may only touch the rows of that tenant. The scope of the
 * platform is asked for by name (spec §3.10).
 */
export async function withScope<T>(
  db: SqlClient,
  scope: Scope,
  action: (client: SqlClient) => Promise<T>
): Promise<T> {
  if ('platform' in scope) {
    return await withPlatformScope(db, action)
  }
  return await withTenantScope(db, scope.tenant, action)
}

/**
 * The role of the connection and what it does with the isolation.
 *
 * A superuser and a role with `BYPASSRLS` are not subject to the
 * policies of the tables: for them the isolation of the tenants is a
 * promise and not a rule. A production deployment refuses to start with
 * such a role (spec §3.10).
 */
export interface DatabaseRole {
  /** The name of the role of the connection. */
  name: string
  /** True when the role is a superuser. */
  superuser: boolean
  /** True when the role bypasses the row level security. */
  bypassesRowLevelSecurity: boolean
}

/** Reads the role of the connection. */
export async function roleOf(db: SqlClient): Promise<DatabaseRole> {
  const rows = await db.query<{ name: string; superuser: boolean; bypasses: boolean }>(
    `select r.rolname as name, r.rolsuper as superuser, r.rolbypassrls as bypasses
     from pg_roles r where r.rolname = current_user`
  )
  const row = rows[0]
  return {
    name: row?.name ?? 'unknown',
    superuser: row?.superuser ?? true,
    bypassesRowLevelSecurity: row?.bypasses ?? true,
  }
}

/**
 * Tells whether the role of the connection bypasses the isolation.
 *
 * A superuser and a role with `BYPASSRLS` are not subject to the
 * policies of the tables: for them the isolation of the tenants is a
 * promise and not a rule. A production deployment refuses to start with
 * such a role (spec §3.10).
 */
export async function bypassesRowLevelSecurity(db: SqlClient): Promise<boolean> {
  const role = await roleOf(db)
  return role.superuser || role.bypassesRowLevelSecurity
}
