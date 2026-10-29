/**
 * The fakes of the tests of the administration.
 *
 * The domain owns the rules and the storage is a port: the tests bring
 * their own storage, and it is a storage in memory. The fakes are
 * created by a factory, so every file of the tests has its own rows and
 * its own rows.
 */

import type { AdminCredential } from './credentials'
import {
  FailedAuthenticationLimiter,
  type AuthenticationFailures,
  type FailureCount,
} from './limiter'
import type {
  AuditContext,
  ChangeAudit,
  Grant,
  GrantFilter,
  GrantStore,
  Group,
  GroupFilter,
  GroupPage,
  GroupStore,
  Permission,
  PermissionStore,
  Principal,
  PrincipalFilter,
  PrincipalStore,
  Role,
  RoleFilter,
  RolePage,
  RoleStore,
  Scope,
  Tenant,
  TenantStore,
  TenantSummary,
} from './ports'
import { AdministrationService } from './service'

/** The facts of a call of the administration. */
export const CONTEXT: AuditContext = {
  operator: 'the-fingerprint',
  address: '10.0.0.1',
  requestId: 'the-request',
}

/** The registration of a tenant of the tests. */
export const TENANT = {
  slug: 'acme',
  displayName: 'Acme Inc',
  issuer: 'https://login.acme.example',
  idpClientId: 'access-acme',
  idpClientSecret: 'the-secret-of-the-provider',
  idpRedirectUri: 'https://access.example.com/oauth/tenant/callback',
  idpScopes: ['openid', 'email', 'profile'],
  idpAlgorithms: ['RS256'],
  emailDomain: 'acme.example',
  clientId: 'gateway-acme',
  clientSecret: 'the-secret-of-the-gateway',
  clientRedirectUris: ['https://gateway-acme.example.com/auth/callback'],
  autoProvision: false,
  sharedClient: false,
  isDefault: false,
  enabled: true,
}

/** The storage of the tenants of the tests. */
class FakeTenants implements TenantStore {
  readonly rows: Tenant[] = []

  async findBySlug(slug: string): Promise<Tenant | null> {
    return this.rows.find((row) => row.slug === slug) ?? null
  }

  async findByClientId(clientId: string): Promise<Tenant | null> {
    return this.rows.find((row) => row.clientId === clientId) ?? null
  }

  async list(): Promise<TenantSummary[]> {
    return this.rows.map((row) => ({ ...row, userCount: 0, grantCount: 0 }))
  }

  async create(
    registration: {
      slug: string
      displayName: string
      issuer: string
      emailDomain: string | null
      clientId: string
      clientRedirectUris: string[]
      autoProvision: boolean
      sharedClient: boolean
      isDefault: boolean
      enabled: boolean
    },
    _audit?: ChangeAudit
  ): Promise<Tenant> {
    const tenant: Tenant = {
      id: `tenant-${this.rows.length + 1}`,
      slug: registration.slug,
      displayName: registration.displayName,
      issuer: registration.issuer,
      emailDomain: registration.emailDomain,
      clientId: registration.clientId,
      clientRedirectUris: registration.clientRedirectUris,
      autoProvision: registration.autoProvision,
      sharedClient: registration.sharedClient,
      isDefault: registration.isDefault,
      enabled: registration.enabled,
      createdAt: new Date('2026-01-08T10:00:00.000Z'),
    }
    this.rows.push(tenant)
    return tenant
  }

  async update(id: string, changes: Partial<Tenant>, _audit?: ChangeAudit): Promise<Tenant | null> {
    const tenant = this.rows.find((row) => row.id === id)
    if (!tenant) return null
    Object.assign(tenant, changes)
    return tenant
  }
}

/** The storage of the principals of the tests. */
class FakePrincipals implements PrincipalStore {
  readonly rows: Principal[] = []

  constructor(private readonly tenants: FakeTenants) {}

  async findById(id: string, _scope?: Scope): Promise<Principal | null> {
    return this.rows.find((row) => row.id === id) ?? null
  }

  async findByExternalSubject(
    tenantId: string,
    externalSubject: string
  ): Promise<Principal | null> {
    const tenant = this.tenants.rows.find((row) => row.id === tenantId)
    return (
      this.rows.find(
        (row) => row.tenant === tenant?.slug && row.externalSubject === externalSubject
      ) ?? null
    )
  }

  async create(
    registration: {
      tenantId: string
      externalSubject: string
      email?: string | null
      displayName?: string | null
      status?: 'active' | 'disabled'
    },
    _audit?: ChangeAudit
  ): Promise<Principal> {
    const tenant = this.tenants.rows.find((row) => row.id === registration.tenantId)
    const principal: Principal = {
      id: `principal-${this.rows.length + 1}`,
      tenant: tenant?.slug ?? '',
      externalSubject: registration.externalSubject,
      email: registration.email ?? null,
      displayName: registration.displayName ?? null,
      status: registration.status ?? 'active',
      lastLoginAt: null,
      createdAt: new Date('2026-01-08T10:05:00.000Z'),
    }
    this.rows.push(principal)
    return principal
  }

  async update(
    id: string,
    changes: { email?: string | null; displayName?: string | null; status?: 'active' | 'disabled' },
    _scope?: Scope,
    _audit?: ChangeAudit
  ): Promise<Principal | null> {
    const principal = this.rows.find((row) => row.id === id)
    if (!principal) return null
    Object.assign(principal, changes)
    return principal
  }

  async list(filter: PrincipalFilter) {
    const matching = this.rows.filter((row) => {
      if (filter.tenantId !== null) {
        const tenant = this.tenants.rows.find((t) => t.id === filter.tenantId)
        if (row.tenant !== tenant?.slug) return false
      }
      if (filter.status !== null && row.status !== filter.status) return false
      if (filter.email !== null && row.email !== filter.email) return false
      return true
    })
    const ordered = [...matching].reverse()
    return {
      principals: ordered.slice(filter.offset, filter.offset + filter.limit),
      total: matching.length,
      limit: filter.limit,
      offset: filter.offset,
    }
  }
}

/** The storage of the permissions of the tests. */
class FakePermissions implements PermissionStore {
  readonly rows: Permission[] = []

  async findCataloguePermission(key: string, _scope?: Scope): Promise<Permission | null> {
    return this.rows.find((row) => row.tenantId === null && row.key === key) ?? null
  }

  async findByTenantAndKey(tenantId: string, key: string): Promise<Permission | null> {
    return this.rows.find((row) => row.tenantId === tenantId && row.key === key) ?? null
  }

  async findByKey(key: string, _scope?: Scope): Promise<Permission | null> {
    return this.rows.find((row) => row.key === key) ?? null
  }

  async create(
    registration: { tenantId: string | null; key: string },
    _scope?: Scope
  ): Promise<Permission> {
    const permission: Permission = {
      id: `permission-${this.rows.length + 1}`,
      tenantId: registration.tenantId,
      key: registration.key,
      description: null,
      enabled: true,
    }
    this.rows.push(permission)
    return permission
  }

  async createOrFind(
    registration: { tenantId: string | null; key: string },
    _scope?: Scope
  ): Promise<Permission> {
    const existing = this.rows.find(
      (row) => row.tenantId === registration.tenantId && row.key === registration.key
    )
    if (existing) return existing
    return await this.create(registration)
  }
}

/** The storage of the grants of the tests. */
class FakeGrants implements GrantStore {
  readonly rows: Grant[] = []

  constructor(
    private readonly tenants: FakeTenants,
    private readonly permissions: FakePermissions,
    private readonly groups: FakeGroups,
    private readonly roles: FakeRoles
  ) {}

  async findById(id: string, _scope?: Scope): Promise<Grant | null> {
    return this.rows.find((row) => row.id === id) ?? null
  }

  async findLive(
    tenantId: string,
    subject: { userId: string | null; groupId: string | null },
    permissionId: string | null,
    roleId: string | null,
    workspaceId: string | null,
    routeId: string | null
  ): Promise<Grant | null> {
    return (
      this.rows.find(
        (row) =>
          row.tenant === this.tenants.rows.find((t) => t.id === tenantId)?.slug &&
          row.userId === subject.userId &&
          row.group === (subject.groupId ?? null) &&
          row.permission ===
            (this.permissions.rows.find((p) => p.id === permissionId)?.key ?? null) &&
          row.role === (this.roles.rows.find((r) => r.id === roleId)?.key ?? null) &&
          row.workspaceId === workspaceId &&
          row.routeId === routeId &&
          row.revokedAt === null
      ) ?? null
    )
  }

  async create(
    registration: {
      tenantId: string
      userId: string | null
      groupId: string | null
      permissionId: string | null
      roleId: string | null
      workspaceId: string | null
      routeId: string | null
      expiresAt: Date | null
      grantedBy: string | null
    },
    _audit?: ChangeAudit
  ): Promise<Grant> {
    const tenant = this.tenants.rows.find((row) => row.id === registration.tenantId)
    const permission = this.permissions.rows.find((row) => row.id === registration.permissionId)
    const group = this.groups.rows.find((row) => row.id === registration.groupId)
    const role = this.roles.rows.find((row) => row.id === registration.roleId)
    const grant: Grant = {
      id: `grant-${this.rows.length + 1}`,
      tenant: tenant?.slug ?? '',
      userId: registration.userId,
      group: group?.key ?? null,
      permission: permission?.key ?? null,
      role: role?.key ?? null,
      workspaceId: registration.workspaceId,
      routeId: registration.routeId,
      expiresAt: registration.expiresAt,
      revokedAt: null,
      grantedBy: registration.grantedBy,
      createdAt: new Date('2026-01-08T10:06:00.000Z'),
    }
    this.rows.push(grant)
    return grant
  }

  async update(
    id: string,
    changes: { expiresAt?: Date | null; grantedBy?: string | null },
    _scope?: Scope,
    _audit?: ChangeAudit
  ): Promise<Grant | null> {
    const grant = this.rows.find((row) => row.id === id)
    if (!grant) return null
    Object.assign(grant, changes)
    return grant
  }

  async revoke(id: string, _scope?: Scope, _audit?: ChangeAudit): Promise<Grant | null> {
    const grant = this.rows.find((row) => row.id === id)
    if (!grant) return null
    grant.revokedAt = new Date('2026-01-08T11:00:00.000Z')
    return grant
  }

  async list(filter: GrantFilter) {
    const now = new Date('2026-01-08T12:00:00.000Z')
    const matching = this.rows.filter((row) => {
      if (filter.tenantId !== null) {
        const tenant = this.tenants.rows.find((t) => t.id === filter.tenantId)
        if (row.tenant !== tenant?.slug) return false
      }
      if (filter.userId !== null && row.userId !== filter.userId) return false
      if (filter.live !== null) {
        const live = row.revokedAt === null && (row.expiresAt === null || row.expiresAt > now)
        if (live !== filter.live) return false
      }
      return true
    })
    const ordered = [...matching].reverse()
    return {
      grants: ordered.slice(filter.offset, filter.offset + filter.limit),
      total: matching.length,
      limit: filter.limit,
      offset: filter.offset,
    }
  }
}

/** The storage of the groups of the tests. */
class FakeGroups implements GroupStore {
  readonly rows: Group[] = []

  constructor(private readonly tenants: FakeTenants) {}

  async findByKey(tenantId: string, key: string): Promise<Group | null> {
    const tenant = this.tenants.rows.find((row) => row.id === tenantId)
    return this.rows.find((row) => row.tenant === tenant?.slug && row.key === key) ?? null
  }

  async create(
    registration: {
      tenantId: string
      key: string
      displayName?: string | null
      memberIds: string[]
    },
    _audit?: ChangeAudit
  ): Promise<Group> {
    const tenant = this.tenants.rows.find((row) => row.id === registration.tenantId)
    const group: Group = {
      id: `group-${this.rows.length + 1}`,
      tenant: tenant?.slug ?? '',
      key: registration.key,
      displayName: registration.displayName ?? null,
      members: registration.memberIds,
      createdAt: new Date('2026-01-08T10:20:00.000Z'),
    }
    this.rows.push(group)
    return group
  }

  async update(
    id: string,
    changes: { displayName?: string | null; memberIds?: string[] },
    _scope?: Scope,
    _audit?: ChangeAudit
  ): Promise<Group | null> {
    const group = this.rows.find((row) => row.id === id)
    if (!group) return null
    if (changes.displayName !== undefined) group.displayName = changes.displayName
    if (changes.memberIds !== undefined) group.members = changes.memberIds
    return group
  }

  async list(filter: GroupFilter): Promise<GroupPage> {
    const matching = this.rows.filter((row) => {
      if (filter.tenantId !== null) {
        const tenant = this.tenants.rows.find((t) => t.id === filter.tenantId)
        if (row.tenant !== tenant?.slug) return false
      }
      if (filter.key !== null && row.key !== filter.key) return false
      return true
    })
    const ordered = [...matching].reverse()
    return {
      groups: ordered.slice(filter.offset, filter.offset + filter.limit),
      total: matching.length,
      limit: filter.limit,
      offset: filter.offset,
    }
  }
}

/**
 * The storage of the roles of the tests.
 *
 * The memberships of a role are kept apart from its row: the role holds
 * the keys of its permissions and of the roles it names, and the fake
 * keeps the identifiers they are written with.
 */
class FakeRoles implements RoleStore {
  readonly rows: Role[] = []
  /** The permissions of every role, by the id of the role. */
  readonly permissions = new Map<string, Set<string>>()
  /** The roles every role names, by the id of the role. */
  readonly nested = new Map<string, Set<string>>()
  /** The grants of the tests, that count the grants of a role. */
  grants?: FakeGrants

  constructor(
    private readonly tenants: FakeTenants,
    private readonly catalogue: FakePermissions
  ) {}

  /** The row of a role, with its memberships. */
  #row(row: Role): Role {
    const permissionIds = this.permissions.get(row.id) ?? new Set<string>()
    const nestedIds = this.nested.get(row.id) ?? new Set<string>()
    return {
      ...row,
      permissionKeys: [...permissionIds]
        .map((id) => this.catalogue.rows.find((permission) => permission.id === id)?.key)
        .filter((key): key is string => key !== undefined)
        .sort(),
      roleKeys: [...nestedIds]
        .map((id) => this.rows.find((role) => role.id === id)?.key)
        .filter((key): key is string => key !== undefined)
        .sort(),
    }
  }

  async findByKey(tenantId: string, key: string): Promise<Role | null> {
    const tenant = this.tenants.rows.find((row) => row.id === tenantId)
    const row = this.rows.find((entry) => entry.tenant === tenant?.slug && entry.key === key)
    return row ? this.#row(row) : null
  }

  async findById(id: string, _scope?: Scope): Promise<Role | null> {
    const row = this.rows.find((entry) => entry.id === id)
    return row ? this.#row(row) : null
  }

  async list(filter: RoleFilter): Promise<RolePage> {
    const matching = this.rows.filter((row) => {
      if (filter.tenantId !== null) {
        const tenant = this.tenants.rows.find((t) => t.id === filter.tenantId)
        if (row.tenant !== tenant?.slug) return false
      }
      if (filter.key !== null && row.key !== filter.key) return false
      return true
    })
    const ordered = [...matching].reverse()
    return {
      roles: ordered
        .slice(filter.offset, filter.offset + filter.limit)
        .map((row) => this.#row(row)),
      total: matching.length,
      limit: filter.limit,
      offset: filter.offset,
    }
  }

  async create(
    registration: {
      tenantId: string
      key: string
      displayName?: string | null
      description?: string | null
    },
    _audit?: ChangeAudit
  ): Promise<Role> {
    const tenant = this.tenants.rows.find((row) => row.id === registration.tenantId)
    const role: Role = {
      id: `role-${this.rows.length + 1}`,
      tenant: tenant?.slug ?? '',
      key: registration.key,
      displayName: registration.displayName ?? null,
      description: registration.description ?? null,
      permissionKeys: [],
      roleKeys: [],
      createdAt: new Date('2026-01-08T10:30:00.000Z'),
    }
    this.rows.push(role)
    this.permissions.set(role.id, new Set())
    this.nested.set(role.id, new Set())
    return this.#row(role)
  }

  async update(
    id: string,
    changes: { displayName?: string | null; description?: string | null },
    _scope?: Scope,
    _audit?: ChangeAudit
  ): Promise<Role | null> {
    const role = this.rows.find((row) => row.id === id)
    if (!role) return null
    if (changes.displayName !== undefined) role.displayName = changes.displayName
    if (changes.description !== undefined) role.description = changes.description
    return this.#row(role)
  }

  async remove(id: string, _scope?: Scope, _audit?: ChangeAudit): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.id === id)
    if (index < 0) return false
    this.rows.splice(index, 1)
    this.permissions.delete(id)
    this.nested.delete(id)
    return true
  }

  async grantPermission(
    roleId: string,
    permissionId: string,
    _scope?: Scope,
    _audit?: ChangeAudit
  ): Promise<boolean> {
    const held = this.permissions.get(roleId)
    if (!held) return false
    held.add(permissionId)
    return true
  }

  async revokePermission(
    roleId: string,
    permissionId: string,
    _scope?: Scope,
    _audit?: ChangeAudit
  ): Promise<boolean> {
    const held = this.permissions.get(roleId)
    if (!held) return false
    return held.delete(permissionId)
  }

  async nest(
    roleId: string,
    childRoleId: string,
    _scope?: Scope,
    _audit?: ChangeAudit
  ): Promise<boolean> {
    const held = this.nested.get(roleId)
    if (!held) return false
    held.add(childRoleId)
    return true
  }

  async unnest(
    roleId: string,
    childRoleId: string,
    _scope?: Scope,
    _audit?: ChangeAudit
  ): Promise<boolean> {
    const held = this.nested.get(roleId)
    if (!held) return false
    return held.delete(childRoleId)
  }

  async descendants(roleId: string, _scope?: Scope): Promise<string[]> {
    const keys: string[] = []
    const seen = new Set<string>()
    const walk = (id: string): void => {
      for (const child of this.nested.get(id) ?? []) {
        if (seen.has(child)) continue
        seen.add(child)
        const key = this.rows.find((role) => role.id === child)?.key
        if (key) keys.push(key)
        walk(child)
      }
    }
    walk(roleId)
    return keys
  }

  async expand(roleId: string, _scope?: Scope): Promise<string[]> {
    const keys = new Set<string>()
    const ids = new Set<string>()
    const walk = (id: string): void => {
      if (ids.has(id)) return
      ids.add(id)
      for (const permission of this.permissions.get(id) ?? []) {
        const key = this.catalogue.rows.find((entry) => entry.id === permission)?.key
        if (key) keys.add(key)
      }
      for (const child of this.nested.get(id) ?? []) walk(child)
    }
    walk(roleId)
    return [...keys].sort()
  }

  async countGrants(roleId: string, _scope?: Scope): Promise<number> {
    const role = this.rows.find((row) => row.id === roleId)
    if (!role || !this.grants) return 0
    return this.grants.rows.filter((row) => row.role === role.key).length
  }
}

/**
 * The count of the failed authentications, in the memory of the tests.
 *
 * The domain owns the rule and the storage is a port: the tests bring
 * their own count, and the platform brings the one of the deployment.
 */
class FakeFailures implements AuthenticationFailures {
  private readonly failures = new Map<string, { count: number; since: number }>()
  private readonly now = () => Date.now()

  async fail(address: string, windowMs: number): Promise<FailureCount> {
    const now = this.now()
    const failure = this.failures.get(address)
    if (!failure || now - failure.since >= windowMs) {
      this.failures.set(address, { count: 1, since: now })
      return { count: 1, retryAfterMs: windowMs }
    }
    failure.count += 1
    return { count: failure.count, retryAfterMs: windowMs - (now - failure.since) }
  }

  async count(address: string, windowMs: number): Promise<FailureCount> {
    const now = this.now()
    const failure = this.failures.get(address)
    if (!failure || now - failure.since >= windowMs) return { count: 0, retryAfterMs: 0 }
    return { count: failure.count, retryAfterMs: windowMs - (now - failure.since) }
  }

  async succeed(address: string): Promise<void> {
    this.failures.delete(address)
  }
}

/** The storages of the tests. */
export interface Fakes {
  /** The storage of the tenants. */
  tenants: FakeTenants
  /** The storage of the principals. */
  principals: FakePrincipals
  /** The storage of the permissions. */
  permissions: FakePermissions
  /** The storage of the grants. */
  grants: FakeGrants
  /** The storage of the groups. */
  groups: FakeGroups
  /** The storage of the roles. */
  roles: FakeRoles
  /** The count of the failed authentications. */
  failures: FakeFailures
}

/** The storages of a file of the tests. */
export function createFakes(): Fakes {
  const tenants = new FakeTenants()
  const permissions = new FakePermissions()
  const principals = new FakePrincipals(tenants)
  const groups = new FakeGroups(tenants)
  const roles = new FakeRoles(tenants, permissions)
  const grants = new FakeGrants(tenants, permissions, groups, roles)
  // The roles count the grants that name them, and the grants resolve
  // the roles they name: the two storages know each other.
  roles.grants = grants
  return {
    tenants,
    principals,
    permissions,
    grants,
    groups,
    roles,
    failures: new FakeFailures(),
  }
}

/** The options of the service of the tests. */
export interface ServiceOptions {
  /** The token of the administration, when it is not the one of the tests. */
  token?: string
  /** The limiter of the failed authentications. */
  limiter?: FailedAuthenticationLimiter
  /** The count of the failed authentications. */
  failures?: AuthenticationFailures
  /** The credentials of the tenants. */
  credentials?: AdminCredential[]
}

/**
 * The service of the tests, on the storages of the tests.
 *
 * The service is the face of the administration: the rules live in one
 * file per resource, and every file of the tests proves the rules
 * through it.
 */
export function serviceOf(fakes: Fakes, options: ServiceOptions = {}): AdministrationService {
  return new AdministrationService({
    tenants: fakes.tenants,
    principals: fakes.principals,
    permissions: fakes.permissions,
    grants: fakes.grants,
    groups: fakes.groups,
    roles: fakes.roles,
    token: options.token ?? 'the-admin-token',
    ...(options.credentials ? { credentials: options.credentials } : {}),
    publicUrl: 'https://access.example.com',
    limiter: options.limiter ?? new FailedAuthenticationLimiter(options.failures ?? fakes.failures),
  })
}
