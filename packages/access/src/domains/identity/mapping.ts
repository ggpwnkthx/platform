/**
 * The mapping of an identity (spec §6.2, §6.4).
 *
 * The external identity of a caller is mapped to exactly one principal
 * row. The key of the mapping is the pair `(tenant, subject)`: an e-mail
 * is mutable and is not an identity.
 */

/** A principal of the platform, as the identity domain knows it. */
export interface Principal {
  id: string
  tenantId: string
  /** The slug of the tenant of the principal. */
  tenantSlug: string
  externalSubject: string
  email: string | null
  displayName: string | null
  status: 'active' | 'disabled'
}

/** The storage of the principals. */
export interface PrincipalLookup {
  /** The principal of an external identity of a tenant. */
  findByExternalSubject(tenantId: string, externalSubject: string): Promise<Principal | null>
  /**
   * The number of principals of a tenant.
   *
   * The count is what tells the first principal of a tenant from the
   * ones that come after it.
   */
  countByTenant(tenantId: string): Promise<number>
  /**
   * Creates a principal.
   *
   * The facts of the creation are the audit of it: a principal that is
   * created by a login is audited like every other change (spec §10.1).
   */
  create(
    principal: {
      tenantId: string
      externalSubject: string
      email?: string | null
      displayName?: string | null
    },
    facts?: PrincipalCreation
  ): Promise<Principal>
}

/**
 * The facts of the creation of a principal, for the audit of it.
 *
 * The operator is the identity that signed in: a principal that a
 * login creates is created by the person who signed in.
 */
interface PrincipalCreation {
  /** The slug of the tenant of the principal. */
  readonly tenant: string
  /** The identity that signed in. */
  readonly operator: string
  /** The address of the caller. */
  readonly address: string
  /** The id of the request. */
  readonly requestId?: string
}

/** The tenant of an identity, as the mapping reads it. */
export interface TenantOfIdentity {
  id: string
  /** The slug of the tenant. */
  slug: string
  /** Whether an unknown external identity creates a principal row. */
  autoProvision: boolean
  enabled: boolean
}

/** The identity of a caller at the provider of a tenant. */
export interface ExternalIdentity {
  /** The subject of the provider. */
  subject: string
  /** The e-mail the provider publishes, when it publishes one. */
  email?: string | null
  /** The name the provider publishes, when it publishes one. */
  name?: string | null
}

/** The failure of a mapping. */
export class MappingError extends Error {
  constructor(
    /** The code of the failure. */
    readonly code: 'identity_unknown' | 'principal_disabled',
    message: string
  ) {
    super(message)
    this.name = 'MappingError'
  }
}

/** The result of a mapping. */
export interface Mapping {
  principal: Principal
  /** True when the principal was created by this login. */
  created: boolean
  /**
   * True when the principal is the first of its tenant.
   *
   * The tenant had no principal at all before this login: the
   * principal that is created first is the one a tenant that hands its
   * administration to its first identity gives it to (spec §6.4).
   */
  first: boolean
}

/**
 * Maps an external identity to a principal.
 *
 * An identity that nobody registered does not get an account because it
 * managed to log in somewhere: the tenant has to allow the
 * auto-provisioning, and a principal that is created has no grant at all.
 */
export async function mapIdentity(
  lookup: PrincipalLookup,
  tenant: TenantOfIdentity,
  identity: ExternalIdentity,
  facts?: { address: string; requestId?: string }
): Promise<Mapping> {
  const existing = await lookup.findByExternalSubject(tenant.id, identity.subject)
  if (existing) {
    if (existing.status === 'disabled') {
      throw new MappingError('principal_disabled', 'the principal is disabled')
    }
    return { principal: existing, created: false, first: false }
  }

  if (!tenant.autoProvision) {
    throw new MappingError('identity_unknown', 'the identity is unknown to the platform')
  }

  // The principal that is created first is the first of its tenant: the
  // tenant had no principal at all before this login.
  const first = (await lookup.countByTenant(tenant.id)) === 0

  const principal = await lookup.create(
    {
      tenantId: tenant.id,
      externalSubject: identity.subject,
      email: identity.email ?? null,
      displayName: identity.name ?? null,
    },
    facts
      ? {
          // The operator of the audit is the identity that signed in: a
          // principal that a login creates is created by the person who
          // signed in.
          tenant: tenant.slug,
          operator: identity.email ?? identity.subject,
          address: facts.address,
          ...(facts.requestId !== undefined ? { requestId: facts.requestId } : {}),
        }
      : undefined
  )
  return { principal, created: true, first }
}
