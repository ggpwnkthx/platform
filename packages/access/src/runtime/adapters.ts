/**
 * The adapters of the storage.
 *
 * The composition root is the only place where the concrete pieces are
 * joined: the repositories of the platform are adapted to the ports of
 * the domains here, and nowhere else. The adaptation is a translation of
 * the rows and of the failures: a domain never sees a row of PostgreSQL
 * and never sees the error of a driver.
 */

import {
  AdministrationError,
  AdministrationService,
  FailedAuthenticationLimiter,
  type AdminCredential,
  type AuditFilter,
  type AuditRecord,
  type AuditRows,
  type AuditStore,
  type AuthenticationFailures,
  type GrantFilter,
  type GrantStore,
  type Group,
  type GroupFilter,
  type GroupStore,
  type PermissionStore,
  type CredentialFilter,
  type CredentialStore,
  type DomainProof,
  type PrincipalFilter,
  type PrincipalStore,
  type ProviderFilter,
  type ProviderStore,
  type Route,
  type RouteStore,
  type Role,
  type RoleFilter,
  type RoleStore,
  type Scope,
  type TenantStore,
} from '../domains/administration'
import { scopeOf, tenantScope, type CredentialHasher } from '../domains/administration'
import {
  CHECK_VIOLATION,
  DatabaseError,
  GROUP_MEMBERSHIP_CONSTRAINT,
  UNIQUE_VIOLATION,
  type AuditRepository,
  type AuditRow,
  type GrantRepository,
  type GrantRow,
  type GroupRepository,
  type GroupRow,
  type CredentialRepository,
  type CredentialRow,
  type PermissionRepository,
  type PermissionRow,
  type ProviderRepository,
  type ProviderRow,
  type RouteRepository,
  type RouteRow,
  type SecretCipher,
  type RoleRepository,
  type RoleRow,
  type TenantRepository,
  type TenantRow,
  type TenantSummary,
  type UserRepository,
  type UserRow,
} from '../platform/postgres'

/** Turns a tenant of the storage into a tenant of the domain. */
function toTenant(row: TenantRow): {
  id: string
  slug: string
  displayName: string
  issuer: string
  idpClientId: string
  emailDomain: string | null
  clientId: string
  clientRedirectUris: string[]
  autoProvision: boolean
  autoProvisionAdmin: boolean
  sharedClient: boolean
  isDefault: boolean
  enabled: boolean
  createdAt: Date
} {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    issuer: row.idpIssuer,
    idpClientId: row.idpClientId,
    emailDomain: row.emailDomain,
    clientId: row.clientId,
    clientRedirectUris: row.clientRedirectUris,
    autoProvision: row.autoProvision,
    autoProvisionAdmin: row.autoProvisionAdmin,
    sharedClient: row.sharedClient,
    isDefault: row.isDefault,
    enabled: row.enabled,
    createdAt: row.createdAt,
  }
}

/** Turns a principal of the storage into a principal of the domain. */
/**
 * Turns a provider of the storage into a provider of the domain.
 *
 * The secret of a provider is never read here: the administration never
 * answers a secret, and the storage is the one that holds it.
 */
function toProvider(row: ProviderRow): {
  id: string
  tenantId: string
  tenant: string
  kind: 'oidc' | 'local'
  slug: string
  displayName: string
  enabled: boolean
  issuer: string
  idpClientId: string
  idpRedirectUri: string
  idpScopes: string[]
  idpAlgorithms: string[]
  createdAt: Date
} {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenant: row.tenantSlug ?? '',
    kind: row.kind,
    slug: row.slug,
    displayName: row.displayName,
    enabled: row.enabled,
    issuer: row.issuer ?? '',
    idpClientId: row.idpClientId ?? '',
    idpRedirectUri: row.idpRedirectUri ?? '',
    idpScopes: row.idpScopes,
    idpAlgorithms: row.idpAlgorithms,
    createdAt: row.createdAt,
  }
}

/**
 * Turns a credential of the storage into a credential of the domain.
 *
 * The verifier of the password is never read here: the administration
 * never answers one, and it never answers the password either.
 */
function toCredential(row: CredentialRow): {
  id: string
  tenant: string
  provider: string
  email: string
  status: 'active' | 'disabled'
  failedAttempts: number
  lockedUntil: Date | null
  passwordChangedAt: Date
  createdAt: Date
} {
  return {
    id: row.id,
    tenant: row.tenantSlug,
    provider: row.providerSlug,
    email: row.email,
    status: row.status,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil,
    passwordChangedAt: row.passwordChangedAt,
    createdAt: row.createdAt,
  }
}

function toPrincipal(row: UserRow): {
  id: string
  tenant: string
  provider: string
  externalSubject: string
  email: string | null
  displayName: string | null
  status: 'active' | 'disabled'
  lastLoginAt: Date | null
  createdAt: Date
} {
  return {
    id: row.id,
    tenant: row.tenantSlug,
    provider: row.providerSlug,
    externalSubject: row.externalSubject,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  }
}

/** Turns a permission of the storage into a permission of the domain. */
function toPermission(row: PermissionRow): {
  id: string
  tenantId: string | null
  key: string
  description: string | null
  enabled: boolean
} {
  return {
    id: row.id,
    tenantId: row.tenantId,
    key: row.key,
    description: row.description,
    enabled: row.enabled,
  }
}

/** Turns a group of the storage into a group of the domain. */
function toGroup(row: GroupRow, members: string[]): Group {
  return {
    id: row.id,
    tenant: row.tenantSlug,
    key: row.key,
    displayName: row.displayName,
    members,
    createdAt: row.createdAt,
  }
}

/** Turns a role of the storage into a role of the domain. */
function toRole(row: RoleRow): Role {
  return {
    id: row.id,
    tenant: row.tenantSlug,
    key: row.key,
    displayName: row.displayName,
    description: row.description,
    permissionKeys: row.permissionKeys,
    roleKeys: row.roleKeys,
    createdAt: row.createdAt,
  }
}

/** Turns a grant of the storage into a grant of the domain. */
function toGrant(row: GrantRow): {
  id: string
  tenant: string
  userId: string | null
  group: string | null
  permission: string | null
  role: string | null
  workspaceId: string | null
  routeId: string | null
  expiresAt: Date | null
  revokedAt: Date | null
  grantedBy: string | null
  createdAt: Date
} {
  return {
    id: row.id,
    tenant: row.tenantSlug,
    userId: row.userId,
    group: row.groupKey,
    permission: row.permissionKey,
    role: row.roleKey,
    workspaceId: row.workspaceId,
    routeId: row.routeId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    grantedBy: row.grantedBy,
    createdAt: row.createdAt,
  }
}

/**
 * Turns the failure of the storage into the failure of the domain.
 *
 * A unique violation is a conflict: the slug, the client id, the domain
 * of the e-mail and the tuple of a grant are unique.
 *
 * The membership of a group is checked by the database (spec §3.5): a
 * member that is not a principal of the tenant is a `404`, the same
 * answer that the administration gives when it finds it before the
 * write.
 */
function translate(error: unknown): unknown {
  if (error instanceof DatabaseError && error.code === UNIQUE_VIOLATION) {
    return new AdministrationError('conflict', 'the value is already used by another tenant')
  }
  if (
    error instanceof DatabaseError &&
    error.code === CHECK_VIOLATION &&
    error.constraint === GROUP_MEMBERSHIP_CONSTRAINT
  ) {
    return new AdministrationError(
      'not_found',
      'a member of the group is not a principal of the tenant'
    )
  }
  return error
}

/** Runs a statement of the storage and translates its failures. */
async function run<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    throw translate(error)
  }
}

export interface AdministrationDependencies {
  tenants: TenantRepository
  /** The providers of the tenants (spec §3.11). */
  providers: ProviderRepository
  /** The routes of the logins (spec §3.13). */
  routes: RouteRepository
  /**
   * The proof of a domain (spec §10.18).
   *
   * The owner of a domain publishes a record that carries the challenge
   * of its route, and the platform reads it.
   */
  proof: DomainProof
  /** The credentials of the local providers (spec §3.12). */
  credentials: CredentialRepository
  /**
   * The hasher of the passwords of the credentials.
   *
   * The domain never hashes a password itself: the algorithm belongs to
   * the platform.
   */
  hasher: CredentialHasher
  users: UserRepository
  groups?: GroupRepository
  roles?: RoleRepository
  permissions: PermissionRepository
  grants: GrantRepository
  /** The storage of the audit of the administration. */
  audit?: AuditRepository
  /**
   * The count of the failed authentications.
   *
   * It is the shared store of the deployment when it has one, so the
   * window of the limiter is the window of the deployment and not the
   * window of a replica (spec §10.1).
   */
  failures: AuthenticationFailures
  /** The bearer token of the administration. */
  token?: string
  /** The token that the current one replaced, during a rotation. */
  previousToken?: string
  /** The credentials of the tenants of the administration (spec §10.1). */
  adminCredentials?: AdminCredential[]
  /** The public url of Access. */
  publicUrl: string
  /**
   * The cipher of the client secrets.
   *
   * The secret of a provider is encrypted before it is written: without
   * a key the administration cannot write a provider, and it says so.
   */
  secrets?: SecretCipher
  /**
   * The key of the permission that opens the administration of a tenant.
   *
   * The key is the one of the console, and the deployment may name
   * another one (spec §6.4).
   */
  tenantAdminPermission?: string
  /**
   * The keys of the capabilities that are not relative to a tenant.
   *
   * Only a credential of the platform may give such a capability to a
   * principal (spec §10.6).
   */
  platformPermissions?: readonly string[]
  /**
   * Called when the registration of a tenant changes.
   *
   * The clients of the providers of the tenant are dropped, so that the
   * next login builds new ones with the new registration (spec §6.6).
   */
  onTenantChanged?: (tenantId: string) => void | Promise<void>
}

/**
 * Builds the administration of the platform.
 *
 * The repositories are adapted to the ports of the domain here: the
 * domain never sees the storage.
 */
export function createAdministrationService(
  dependencies: AdministrationDependencies
): AdministrationService {
  const tenantStore: TenantStore = {
    findBySlug: async (slug) => {
      const row = await run(async () => await dependencies.tenants.findBySlug(slug))
      return row ? toTenant(row) : null
    },
    findByClientId: async (clientId) => {
      const row = await run(async () => await dependencies.tenants.findByClientId(clientId))
      return row ? toTenant(row) : null
    },
    list: async () => {
      const rows = await run(async () => await dependencies.tenants.list())
      return rows.map((row: TenantSummary) => ({
        ...toTenant(row),
        userCount: row.userCount,
        grantCount: row.grantCount,
      }))
    },
    create: async (registration, audit) => {
      const row = await run(async () => await dependencies.tenants.create(registration, audit))
      await dependencies.onTenantChanged?.(row.id)
      return toTenant(row)
    },
    update: async (id, registration, audit) => {
      const row = await run(async () => await dependencies.tenants.update(id, registration, audit))
      if (row) await dependencies.onTenantChanged?.(id)
      return row ? toTenant(row) : null
    },
  }

  /**
   * Encrypts the secret of a provider before it is written.
   *
   * A deployment without a key of the secrets cannot write a provider:
   * the secret would be stored in clear, and the administration refuses
   * to do that (spec §4.3).
   */
  const encrypt = async (clear: string): Promise<Uint8Array> => {
    if (!dependencies.secrets) {
      throw new AdministrationError(
        'invalid_request',
        'the deployment cannot write the secret of a provider: the key of the deployment is not set'
      )
    }
    return dependencies.secrets.encrypt(clear)
  }

  const providerStore: ProviderStore = {
    findBySlug: async (tenantId, slug) => {
      const row = await run(
        async () => await dependencies.providers.findByTenantAndSlug(tenantId, slug)
      )
      return row ? toProvider(row) : null
    },
    findById: async (id, scope) => {
      const row = await run(async () => await dependencies.providers.findById(id))
      if (!row) return null
      // The scope of the call is the scope of the statement: a provider
      // of another tenant is not a provider the call may read.
      if ('tenant' in scope && scope.tenant !== row.tenantId) return null
      return toProvider(row)
    },
    list: async (filter: ProviderFilter) => {
      const page = await run(
        async () =>
          await dependencies.providers.list({
            tenantId: filter.tenantId,
            slug: filter.slug,
            limit: filter.limit,
            offset: filter.offset,
          })
      )
      return {
        providers: page.rows.map(toProvider),
        total: page.total,
        limit: filter.limit,
        offset: filter.offset,
      }
    },
    create: async (registration, audit) => {
      const row = await run(
        async () =>
          await dependencies.providers.create(
            {
              ...registration,
              idpClientSecret: await encrypt(registration.idpClientSecret),
            },
            audit
          )
      )
      return toProvider(row)
    },
    update: async (id, changes, _scope, audit) => {
      const row = await run(
        async () =>
          await dependencies.providers.update(
            id,
            {
              ...(changes.displayName !== undefined ? { displayName: changes.displayName } : {}),
              ...(changes.enabled !== undefined ? { enabled: changes.enabled } : {}),
              ...(changes.issuer !== undefined ? { issuer: changes.issuer } : {}),
              ...(changes.idpClientId !== undefined ? { idpClientId: changes.idpClientId } : {}),
              ...(changes.idpClientSecret !== undefined
                ? { idpClientSecret: await encrypt(changes.idpClientSecret) }
                : {}),
              ...(changes.idpRedirectUri !== undefined
                ? { idpRedirectUri: changes.idpRedirectUri }
                : {}),
              ...(changes.idpScopes !== undefined ? { idpScopes: changes.idpScopes } : {}),
              ...(changes.idpAlgorithms !== undefined
                ? { idpAlgorithms: changes.idpAlgorithms }
                : {}),
            },
            audit
          )
      )
      return row ? toProvider(row) : null
    },
    remove: async (id, _scope, audit) =>
      await run(async () => await dependencies.providers.remove(id, audit)),
  }

  const credentialStore: CredentialStore = {
    findByEmail: async (tenantSlug, providerSlug, email) => {
      const row = await run(
        async () => await dependencies.credentials.findByEmail(tenantSlug, providerSlug, email)
      )
      return row ? toCredential(row) : null
    },
    findById: async (id, scope) => {
      const row = await run(async () => await dependencies.credentials.findById(id, scope))
      return row ? toCredential(row) : null
    },
    list: async (filter: CredentialFilter) => {
      const page = await run(async () => await dependencies.credentials.list(filter))
      return {
        credentials: page.rows.map(toCredential),
        total: page.total,
        limit: filter.limit,
        offset: filter.offset,
      }
    },
    create: async (registration, audit) => {
      const row = await run(
        async () =>
          await dependencies.credentials.create(
            {
              ...registration,
              // The verifier of the password is written by the platform:
              // the domain never hashes a password itself.
              passwordHash: await dependencies.hasher.hash(registration.password),
            },
            audit
          )
      )
      return toCredential(row)
    },
    update: async (id, changes, scope, audit) => {
      const row = await run(
        async () =>
          await dependencies.credentials.update(
            id,
            {
              ...(changes.email !== undefined ? { email: changes.email } : {}),
              ...(changes.password !== undefined
                ? { passwordHash: await dependencies.hasher.hash(changes.password) }
                : {}),
              ...(changes.status !== undefined ? { status: changes.status } : {}),
            },
            scope,
            audit
          )
      )
      return row ? toCredential(row) : null
    },
    remove: async (id, scope, audit) =>
      await run(async () => await dependencies.credentials.remove(id, scope, audit)),
  }

  const principalStore: PrincipalStore = {
    findById: async (id, scope) => {
      const row = await run(async () => await dependencies.users.findById(id, scope))
      return row ? toPrincipal(row) : null
    },
    findByExternalSubject: async (tenantId, providerSlug, externalSubject) => {
      const row = await run(
        async () =>
          await dependencies.users.findByExternalSubject(tenantId, providerSlug, externalSubject)
      )
      return row ? toPrincipal(row) : null
    },
    create: async (registration, audit) => {
      const row = await run(async () => await dependencies.users.create(registration, audit))
      return toPrincipal(row)
    },
    update: async (id, changes, scope, audit) => {
      const row = await run(async () => await dependencies.users.update(id, changes, scope, audit))
      return row ? toPrincipal(row) : null
    },
    list: async (filter: PrincipalFilter) => {
      const page = await run(async () => await dependencies.users.list(filter))
      return {
        principals: page.rows.map(toPrincipal),
        total: page.total,
        limit: filter.limit,
        offset: filter.offset,
      }
    },
    countByProvider: async (tenantId, providerSlug) =>
      await run(async () => await dependencies.users.countByProvider(tenantId, providerSlug)),
  }

  const permissionStore: PermissionStore = {
    findCataloguePermission: async (key, scope) => {
      const row = await run(
        async () => await dependencies.permissions.findCataloguePermission(key, scope)
      )
      return row ? toPermission(row) : null
    },
    findByTenantAndKey: async (tenantId, key) => {
      const row = await run(
        async () => await dependencies.permissions.findByTenantAndKey(tenantId, key)
      )
      return row ? toPermission(row) : null
    },
    findByKey: async (key, scope) => {
      const row = await run(async () => await dependencies.permissions.findByKey(key, scope))
      return row ? toPermission(row) : null
    },
    create: async (registration, scope) => {
      const row = await run(async () => await dependencies.permissions.create(registration, scope))
      return toPermission(row)
    },
    createOrFind: async (registration, scope) => {
      const row = await run(
        async () => await dependencies.permissions.createOrFind(registration, scope)
      )
      return toPermission(row)
    },
  }

  /**
   * The external subjects of the principals of a group.
   *
   * The membership is stored as the ids of the principals and it is
   * published as the external identities of the principals: the
   * translation is the work of the adapter.
   */
  const membersOf = async (ids: string[], scope: Scope): Promise<string[]> => {
    if (ids.length === 0) return []
    const rows = await run(
      async () => await dependencies.users.findExternalSubjectsByIds(ids, scope)
    )
    return rows
  }

  const groupStore: GroupStore | undefined = dependencies.groups
    ? {
        findByKey: async (tenantId, key) => {
          const row = await run(async () => await dependencies.groups!.findByKey(tenantId, key))
          if (!row) return null
          return toGroup(row, await membersOf(row.members, tenantScope(tenantId)))
        },
        list: async (filter: GroupFilter) => {
          const page = await run(async () => await dependencies.groups!.list(filter))
          const scope = scopeOf(filter.tenantId)
          const groups = await Promise.all(
            page.rows.map(async (row: GroupRow) =>
              toGroup(row, await membersOf(row.members, scope))
            )
          )
          return {
            groups,
            total: page.total,
            limit: filter.limit,
            offset: filter.offset,
          }
        },
        create: async (registration, audit) => {
          const row = await run(
            async () =>
              await dependencies.groups!.create(
                {
                  tenantId: registration.tenantId,
                  key: registration.key,
                  displayName: registration.displayName ?? null,
                  members: registration.memberIds,
                },
                audit
              )
          )
          return toGroup(row, await membersOf(row.members, tenantScope(registration.tenantId)))
        },
        update: async (id, changes, scope, audit) => {
          const row = await run(
            async () =>
              await dependencies.groups!.update(
                id,
                {
                  displayName: changes.displayName,
                  ...(changes.memberIds ? { members: changes.memberIds } : {}),
                },
                scope,
                audit
              )
          )
          if (!row) return null
          return toGroup(row, await membersOf(row.members, scope))
        },
      }
    : undefined

  const roleStore: RoleStore | undefined = dependencies.roles
    ? {
        findByKey: async (tenantId, key) => {
          const row = await run(async () => await dependencies.roles!.findByKey(tenantId, key))
          return row ? toRole(row) : null
        },
        findById: async (id, scope) => {
          const row = await run(async () => await dependencies.roles!.findById(id, scope))
          return row ? toRole(row) : null
        },
        list: async (filter: RoleFilter) => {
          const page = await run(async () => await dependencies.roles!.list(filter))
          return {
            roles: page.rows.map(toRole),
            total: page.total,
            limit: filter.limit,
            offset: filter.offset,
          }
        },
        create: async (registration, audit) => {
          const row = await run(
            async () =>
              await dependencies.roles!.create(
                {
                  tenantId: registration.tenantId,
                  key: registration.key,
                  displayName: registration.displayName ?? null,
                  description: registration.description ?? null,
                },
                audit
              )
          )
          return toRole(row)
        },
        update: async (id, changes, scope, audit) => {
          const row = await run(
            async () => await dependencies.roles!.update(id, changes, scope, audit)
          )
          return row ? toRole(row) : null
        },
        remove: async (id, scope, audit) => {
          return await run(async () => await dependencies.roles!.remove(id, scope, audit))
        },
        grantPermission: async (roleId, permissionId, scope, audit) => {
          return await run(
            async () =>
              await dependencies.roles!.grantPermission(roleId, permissionId, scope, audit)
          )
        },
        revokePermission: async (roleId, permissionId, scope, audit) => {
          return await run(
            async () =>
              await dependencies.roles!.revokePermission(roleId, permissionId, scope, audit)
          )
        },
        nest: async (roleId, childRoleId, scope, audit) => {
          return await run(
            async () => await dependencies.roles!.nest(roleId, childRoleId, scope, audit)
          )
        },
        unnest: async (roleId, childRoleId, scope, audit) => {
          return await run(
            async () => await dependencies.roles!.unnest(roleId, childRoleId, scope, audit)
          )
        },
        descendants: async (roleId, scope) => {
          return await run(async () => await dependencies.roles!.descendants(roleId, scope))
        },
        expand: async (roleId, scope) => {
          return await run(
            async () => await dependencies.roles!.expandedPermissionsOf(roleId, scope)
          )
        },
        countGrants: async (roleId, scope) => {
          return await run(async () => await dependencies.roles!.countGrants(roleId, scope))
        },
      }
    : undefined

  const grantStore: GrantStore = {
    findById: async (id, scope) => {
      const row = await run(async () => await dependencies.grants.findById(id, scope))
      return row ? toGrant(row) : null
    },
    findLive: async (tenantId, subject, permissionId, roleId, workspaceId, routeId) => {
      const row = await run(
        async () =>
          await dependencies.grants.findLive(
            tenantId,
            subject,
            permissionId,
            roleId,
            workspaceId,
            routeId
          )
      )
      return row ? toGrant(row) : null
    },
    findLiveByPermission: async (tenantId, permission, workspaceId) => {
      const rows = await run(
        async () =>
          await dependencies.grants.findLiveByPermission(tenantId, permission, workspaceId)
      )
      return rows.map(toGrant)
    },
    findLiveByRole: async (tenantId, role, workspaceId) => {
      const rows = await run(
        async () => await dependencies.grants.findLiveByRole(tenantId, role, workspaceId)
      )
      return rows.map(toGrant)
    },
    create: async (registration, audit) => {
      const row = await run(async () => await dependencies.grants.create(registration, audit))
      return toGrant(row)
    },
    update: async (id, changes, scope, audit) => {
      const row = await run(async () => await dependencies.grants.update(id, changes, scope, audit))
      return row ? toGrant(row) : null
    },
    revoke: async (id, scope, audit) => {
      const row = await run(async () => await dependencies.grants.revoke(id, scope, audit))
      return row ? toGrant(row) : null
    },
    list: async (filter: GrantFilter) => {
      const page = await run(async () => await dependencies.grants.list(filter))
      return {
        grants: page.rows.map(toGrant),
        total: page.total,
        limit: filter.limit,
        offset: filter.offset,
      }
    },
  }

  /** Turns a row of a route into a row of the domain. */
  const toRoute = (row: RouteRow): Route => ({
    id: row.id,
    kind: row.kind,
    key: row.key,
    tenant: row.tenantSlug,
    provider: row.providerSlug,
    status: row.status,
    verification: row.verification,
    challenge: row.challenge ?? '',
    verifiedAt: row.verifiedAt,
    verifiedBy: row.verifiedBy,
    createdAt: row.createdAt,
  })

  const routeStore: RouteStore = {
    findById: async (id, scope) => {
      const row = await run(async () => await dependencies.routes.findByIdInScope(id, scope))
      return row ? toRoute(row) : null
    },
    findByKey: async (kind, key, scope) => {
      const row = await run(async () => await dependencies.routes.findByKey(kind, key, scope))
      return row ? toRoute(row) : null
    },
    list: async (filter) => {
      const page = await run(async () => await dependencies.routes.list(filter))
      return {
        routes: page.rows.map(toRoute),
        total: page.total,
        limit: filter.limit,
        offset: filter.offset,
      }
    },
    create: async (registration, audit) => {
      const row = await run(async () => await dependencies.routes.create(registration, audit))
      return toRoute(row)
    },
    update: async (id, changes, scope, audit) => {
      const row = await run(async () => await dependencies.routes.update(id, changes, scope, audit))
      return row ? toRoute(row) : null
    },
    verify: async (id, input, scope, audit) => {
      const row = await run(async () => await dependencies.routes.verify(id, input, scope, audit))
      return row ? toRoute(row) : null
    },
  }

  /** Turns a row of the audit into a row of the domain. */
  const toAudit = (row: AuditRow): AuditRecord => ({
    id: row.id,
    at: row.at,
    action: row.action,
    targetId: row.targetId,
    tenant: row.tenant,
    operator: row.operator,
    address: row.address,
    requestId: row.requestId,
  })

  const auditStore: AuditStore | undefined = dependencies.audit
    ? {
        list: async (filter: AuditFilter): Promise<AuditRows> => {
          const page = await run(async () => await dependencies.audit!.list(filter))
          return {
            records: page.rows.map(toAudit),
            total: page.total,
          }
        },
      }
    : undefined

  return new AdministrationService({
    tenants: tenantStore,
    providers: providerStore,
    routes: routeStore,
    proof: dependencies.proof,
    localCredentials: credentialStore,
    hasher: dependencies.hasher,
    principals: principalStore,
    permissions: permissionStore,
    grants: grantStore,
    groups: groupStore,
    roles: roleStore,
    audit: auditStore,
    token: dependencies.token,
    previousToken: dependencies.previousToken,
    ...(dependencies.adminCredentials ? { credentials: dependencies.adminCredentials } : {}),
    ...(dependencies.tenantAdminPermission
      ? { tenantAdminPermission: dependencies.tenantAdminPermission }
      : {}),
    ...(dependencies.platformPermissions
      ? { platformPermissions: dependencies.platformPermissions }
      : {}),
    publicUrl: dependencies.publicUrl,
    limiter: new FailedAuthenticationLimiter(dependencies.failures),
  })
}
