/**
 * The roles of the tenants (spec §3.6).
 *
 * A role is a named set of permissions of a tenant. A grant may name a
 * role instead of a permission: the grant then holds for every
 * principal that holds the role.
 *
 * A role may name another role: the permissions of the named role are
 * the permissions of the naming role, and the naming is transitive. The
 * expansion is a recursive statement, and the schema refuses a cycle:
 * a role that names itself would expand forever.
 */

import { withTenantScope } from './scope'
import { auditedCte } from './audited'
import type { SqlClient } from './database'
import type { ChangeAudit } from '../../domains/administration'

/** The row of a role. */
export interface RoleRow {
  id: string
  tenantId: string
  /** The slug of the tenant of the role. */
  tenantSlug: string
  /** The name of the role. */
  key: string
  displayName: string | null
  description: string | null
  /** The keys of the permissions the role names. */
  permissionKeys: string[]
  /** The keys of the roles the role names. */
  roleKeys: string[]
  createdAt: Date
  updatedAt: Date
}

/** The fields of the creation of a role. */
export interface NewRole {
  tenantId: string
  key: string
  displayName?: string | null
  description?: string | null
}

/** The filter of the list of the roles. */
export interface RoleListFilter {
  /** The id of the tenant, or null for every tenant. */
  tenantId: string | null
  /** The key of the role, or null for every key. */
  key: string | null
  /** The size of the page. */
  limit: number
  /** The number of rows that are skipped. */
  offset: number
}

/** The row of a role, as the database holds it. */
interface RoleRecord {
  id: string
  tenant_id: string
  tenant_slug: string
  key: string
  display_name: string | null
  description: string | null
  permission_keys: string[] | null
  role_keys: string[] | null
  created_at: Date
  updated_at: Date
}

/**
 * The columns of a role.
 *
 * The permissions and the roles the role names are read with the row:
 * the administration shows the content of a role, and a second statement
 * for it would be a second answer that may disagree with the first.
 */
const COLUMNS = `roles.id, roles.tenant_id, roles.key, roles.display_name, roles.description,
  roles.created_at, roles.updated_at, tenants.slug as tenant_slug,
  coalesce(
    (select array_agg(p.key order by p.key)
       from role_permissions rp join permissions p on p.id = rp.permission_id
      where rp.role_id = roles.id),
    '{}'
  ) as permission_keys,
  coalesce(
    (select array_agg(nested.key order by nested.key)
       from role_roles rr join roles nested on nested.id = rr.child_role_id
      where rr.role_id = roles.id),
    '{}'
  ) as role_keys`

/** Turns the row of the database into the row of the domain. */
function toRow(record: RoleRecord): RoleRow {
  return {
    id: record.id,
    tenantId: record.tenant_id,
    tenantSlug: record.tenant_slug,
    key: record.key,
    displayName: record.display_name,
    description: record.description,
    permissionKeys: record.permission_keys ?? [],
    roleKeys: record.role_keys ?? [],
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

/** The storage of the roles. */
export class RoleRepository {
  constructor(private readonly db: SqlClient) {}

  /** The role of an id. */
  async findById(id: string): Promise<RoleRow | null> {
    const rows = await this.db.query<RoleRecord>(
      `select ${COLUMNS} from roles join tenants on tenants.id = roles.tenant_id
       where roles.id = $1`,
      [id]
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  /** The role of a key, in the scope of a tenant. */
  async findByKey(tenantId: string, key: string): Promise<RoleRow | null> {
    const rows = await withTenantScope(
      this.db,
      tenantId,
      async (client) =>
        await client.query<RoleRecord>(
          `select ${COLUMNS} from roles join tenants on tenants.id = roles.tenant_id
           where roles.tenant_id = $1 and roles.key = $2`,
          [tenantId, key]
        )
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  /** The roles of a tenant. */
  async findByTenant(tenantId: string): Promise<RoleRow[]> {
    const rows = await withTenantScope(
      this.db,
      tenantId,
      async (client) =>
        await client.query<RoleRecord>(
          `select ${COLUMNS} from roles join tenants on tenants.id = roles.tenant_id
           where roles.tenant_id = $1 order by roles.key`,
          [tenantId]
        )
    )
    return rows.map(toRow)
  }

  /**
   * The roles that match a filter, and their number.
   *
   * The order is the newest first, and it is stable: two pages never
   * show the same row twice and never skip one (spec §10.5).
   */
  async list(filter: RoleListFilter): Promise<{ rows: RoleRow[]; total: number }> {
    const conditions: string[] = []
    const params: unknown[] = []
    if (filter.tenantId !== null) {
      params.push(filter.tenantId)
      conditions.push(`roles.tenant_id = $${params.length}`)
    }
    if (filter.key !== null) {
      params.push(filter.key)
      conditions.push(`roles.key = $${params.length}`)
    }
    const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : ''
    const page = await withTenantScope(this.db, filter.tenantId, async (client) => {
      const counted = await client.query<{ count: number }>(
        `select count(*)::int as count from roles ${where}`,
        params
      )
      const rows = await client.query<RoleRecord>(
        `select ${COLUMNS} from roles join tenants on tenants.id = roles.tenant_id
         ${where}
         order by roles.created_at desc, roles.id desc
         limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, filter.limit, filter.offset]
      )
      return { rows, total: counted[0]?.count ?? 0 }
    })
    return { rows: page.rows.map(toRow), total: page.total }
  }

  /**
   * Creates a role.
   *
   * The row of the audit of the creation is written by the same statement
   * as the role: a role that is not audited does not exist (spec §10.1).
   */
  async create(input: NewRole, audit?: ChangeAudit | null): Promise<RoleRow> {
    const params: unknown[] = [
      input.tenantId,
      input.key,
      input.displayName ?? null,
      input.description ?? null,
    ]
    const audited = auditedCte('inserted', params, audit)
    const rows = await this.db.query<RoleRecord>(
      `with inserted as (
         insert into roles (tenant_id, key, display_name, description)
         values ($1, $2, $3, $4)
         returning id, tenant_id, key, display_name, description, created_at, updated_at
       )${audited}
       select inserted.*, tenants.slug as tenant_slug, '{}'::text[] as permission_keys,
         '{}'::text[] as role_keys
       from inserted join tenants on tenants.id = inserted.tenant_id`,
      params
    )
    return toRow(rows[0]!)
  }

  /**
   * Changes a role.
   *
   * The row of the audit of the change is written by the same statement
   * as the role (spec §10.1).
   */
  async update(
    id: string,
    input: { displayName?: string | null; description?: string | null },
    audit?: ChangeAudit | null
  ): Promise<RoleRow | null> {
    const assignments: string[] = []
    const params: unknown[] = []
    const set = (column: string, value: unknown): void => {
      params.push(value)
      assignments.push(`${column} = $${params.length}`)
    }
    if (input.displayName !== undefined) set('display_name', input.displayName)
    if (input.description !== undefined) set('description', input.description)
    if (assignments.length === 0) {
      // The call changed nothing, but it is still a call of the
      // administration: the row is rewritten with the values it has, so
      // that the row of the audit is written by the same statement as
      // the row it names.
      assignments.push('id = id')
    } else {
      set('updated_at', new Date())
    }
    params.push(id)
    const idParam = params.length
    const audited = auditedCte('updated', params, audit)
    const rows = await this.db.query<RoleRecord>(
      `with updated as (
         update roles set ${assignments.join(', ')} where id = $${idParam}
         returning id, tenant_id, key, display_name, description, created_at, updated_at
       )${audited}
       select updated.*, tenants.slug as tenant_slug, '{}'::text[] as permission_keys,
         '{}'::text[] as role_keys
       from updated join tenants on tenants.id = updated.tenant_id`,
      params
    )
    return rows[0] ? toRow(rows[0]) : null
  }

  /**
   * Removes a role.
   *
   * A role that a grant names is not removed: the grants of the policy
   * are kept, and the operator revokes them first. The removal of a
   * role that no grant names is a removal of a name and of the
   * permissions it held.
   */
  async remove(id: string, audit?: ChangeAudit | null): Promise<boolean> {
    const params: unknown[] = [id]
    const audited = auditedCte('removed', params, audit)
    const rows = await this.db.query<{ id: string }>(
      `with removed as (
         delete from roles where id = $1 returning id
       )${audited}
       select id from removed`,
      params
    )
    return rows.length > 0
  }

  /**
   * The permissions a role names, the ones it names directly.
   */
  async permissionsOf(roleId: string): Promise<string[]> {
    const rows = await this.db.query<{ key: string }>(
      `select p.key from role_permissions rp join permissions p on p.id = rp.permission_id
       where rp.role_id = $1 order by p.key`,
      [roleId]
    )
    return rows.map((row) => row.key)
  }

  /**
   * The keys of the roles the role names, the nested ones included.
   *
   * The closure is a recursive statement, and it is a `union`: a cycle
   * of the roles answers instead of expanding forever.
   */
  async descendants(roleId: string): Promise<string[]> {
    const rows = await this.db.query<{ key: string }>(
      `with recursive descendants(role_id) as (
         select rr.child_role_id from role_roles rr where rr.role_id = $1
         union
         select rr.child_role_id
           from descendants d
           join role_roles rr on rr.role_id = d.role_id
       )
       select distinct r.key
         from descendants d join roles r on r.id = d.role_id
        order by r.key`,
      [roleId]
    )
    return rows.map((row) => row.key)
  }

  /**
   * The permissions a role holds, the ones it names and the ones of the
   * roles it names.
   *
   * The expansion is a recursive statement, and it is a `union`: a cycle
   * of the roles would otherwise expand forever. The schema refuses a
   * cycle, and the statement answers in every case.
   */
  async expandedPermissionsOf(roleId: string): Promise<string[]> {
    const rows = await this.db.query<{ key: string }>(
      `with recursive descendants(role_id) as (
         select rr.child_role_id from role_roles rr where rr.role_id = $1
         union
         select rr.child_role_id
           from descendants d
           join role_roles rr on rr.role_id = d.role_id
       )
       select distinct p.key
         from role_permissions rp
         join permissions p on p.id = rp.permission_id
        where rp.role_id = $1
           or rp.role_id in (select role_id from descendants)
        order by p.key`,
      [roleId]
    )
    return rows.map((row) => row.key)
  }

  /**
   * Gives a permission to a role.
   *
   * The row of the audit is written by the same statement as the
   * membership: a permission that is given and not audited does not
   * exist (spec §10.1).
   */
  async grantPermission(
    roleId: string,
    permissionId: string,
    audit?: ChangeAudit | null
  ): Promise<boolean> {
    const params: unknown[] = [roleId, permissionId]
    const audited = auditedCte('granted', params, audit, 'role_id')
    const rows = await this.db.query<{ role_id: string }>(
      `with granted as (
         insert into role_permissions (tenant_id, role_id, permission_id)
         select roles.tenant_id, roles.id, $2 from roles where roles.id = $1
         on conflict do nothing
         returning role_id
       )${audited}
       select role_id from granted`,
      params
    )
    return rows.length > 0
  }

  /**
   * Takes a permission away from a role.
   *
   * The role keeps the permissions of the roles it names: the statement
   * removes what the role names directly.
   */
  async revokePermission(
    roleId: string,
    permissionId: string,
    audit?: ChangeAudit | null
  ): Promise<boolean> {
    const params: unknown[] = [roleId, permissionId]
    const audited = auditedCte('revoked', params, audit, 'role_id')
    const rows = await this.db.query<{ role_id: string }>(
      `with revoked as (
         delete from role_permissions where role_id = $1 and permission_id = $2
         returning role_id
       )${audited}
       select role_id from revoked`,
      params
    )
    return rows.length > 0
  }

  /**
   * Makes a role name another role.
   *
   * The permissions of the named role become the permissions of the role
   * that names it. A cycle is refused by the schema: the statement
   * fails and nothing is written.
   */
  async nest(roleId: string, childRoleId: string, audit?: ChangeAudit | null): Promise<boolean> {
    const params: unknown[] = [roleId, childRoleId]
    const audited = auditedCte('nested', params, audit, 'role_id')
    const rows = await this.db.query<{ role_id: string }>(
      `with nested as (
         insert into role_roles (tenant_id, role_id, child_role_id)
         select parent.tenant_id, parent.id, child.id
           from roles parent join roles child on child.tenant_id = parent.tenant_id
          where parent.id = $1 and child.id = $2
         on conflict do nothing
         returning role_id
       )${audited}
       select role_id from nested`,
      params
    )
    return rows.length > 0
  }

  /**
   * Makes a role name another role no more.
   */
  async unnest(roleId: string, childRoleId: string, audit?: ChangeAudit | null): Promise<boolean> {
    const params: unknown[] = [roleId, childRoleId]
    const audited = auditedCte('unnested', params, audit, 'role_id')
    const rows = await this.db.query<{ role_id: string }>(
      `with unnested as (
         delete from role_roles where role_id = $1 and child_role_id = $2 returning role_id
       )${audited}
       select role_id from unnested`,
      params
    )
    return rows.length > 0
  }

  /**
   * The roles a principal holds.
   *
   * The roles are the ones the grants of the principal name, and the
   * ones the grants of the groups of the principal name.
   */
  async rolesOfUser(userId: string): Promise<RoleRow[]> {
    const rows = await this.db.query<RoleRecord>(
      `select distinct ${COLUMNS}
         from grants g
         join roles on roles.id = g.role_id
         join tenants on tenants.id = roles.tenant_id
        where g.user_id = $1 and g.revoked_at is null
          and (g.expires_at is null or g.expires_at > now())
        order by roles.key`,
      [userId]
    )
    return rows.map(toRow)
  }

  /**
   * The roles the members of a group hold.
   */
  async rolesOfGroup(groupId: string): Promise<RoleRow[]> {
    const rows = await this.db.query<RoleRecord>(
      `select distinct ${COLUMNS}
         from grants g
         join roles on roles.id = g.role_id
         join tenants on tenants.id = roles.tenant_id
        where g.group_id = $1 and g.revoked_at is null
          and (g.expires_at is null or g.expires_at > now())
        order by roles.key`,
      [groupId]
    )
    return rows.map(toRow)
  }

  /**
   * The number of the grants that name a role.
   *
   * A role that a grant names is not removed: the operator revokes the
   * grants first.
   */
  async countGrants(roleId: string): Promise<number> {
    const rows = await this.db.query<{ count: number }>(
      `select count(*)::int as count from grants where role_id = $1`,
      [roleId]
    )
    return rows[0]?.count ?? 0
  }
}
