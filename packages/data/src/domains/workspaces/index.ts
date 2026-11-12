/**
 * The workspace registry (spec §6.1).
 *
 * A workspace is a resource of the backend: it belongs to exactly one
 * tenant of Access and it is either active or disabled. The registry stores
 * the reference to the tenant of access, never a copy of its directory: the
 * backend does not own the identity of a tenant and it does not own the
 * grants of a principal.
 *
 * The identity of a workspace is read before the context of a request
 * exists. That read is a narrow bootstrap exception: the adapter may
 * only read the identity of a workspace and the catalog of the
 * workspace, and it may only look one workspace up by its exact id.
 *
 * The registry is also written by the service: the creation of a
 * workspace is a call of the tenant (§9.11), and the write is the one
 * statement that the role of the api makes on the registry.
 */

/** The state of a workspace. */
export type WorkspaceStatus = 'active' | 'disabled'

/** The identity of a workspace, as the registry holds it. */
export interface WorkspaceIdentity {
  /** The identifier of the workspace. */
  readonly id: string
  /** The tenant of Access the workspace belongs to. */
  readonly tenantId: string
  /** The state of the workspace. */
  readonly status: WorkspaceStatus
  /**
   * The slug of the workspace, as the registry holds it.
   *
   * The slug is the short name of the workspace: it is the name the
   * registry knows it by, and it is not the identifier it is called by
   * in the urls of the API.
   */
  readonly slug?: string
  /**
   * The name of the workspace, as the registry holds it.
   *
   * The name is the label of the workspace for the humans, and it is
   * absent when the registry holds none for it.
   */
  readonly displayName?: string
}

/** The registration of a workspace. */
export interface WorkspaceRegistration {
  /** The identifier of the workspace. */
  readonly id: string
  /** The tenant of Access the workspace belongs to. */
  readonly tenantId: string
  /** The short name of the workspace, unique in its tenant. */
  readonly slug: string
  /** The name of the workspace, for the humans. */
  readonly displayName: string
}

/**
 * The scope of the write of the registry.
 *
 * The write carries the tenant of the workspace and the principal that
 * asked for it: the row level security of the registry refuses a write
 * that names another tenant.
 */
export interface WorkspaceWriteScope {
  /** The tenant the write belongs to. */
  readonly tenantId: string
  /** The principal that asked for the workspace. */
  readonly principalId: string
}

/** The registry of the workspaces, as the service writes it. */
export interface WorkspaceCreator {
  /**
   * Creates a workspace of a tenant.
   *
   * A slug that the tenant already holds is a conflict: the slug is the
   * name of the workspace inside its tenant, and two workspaces of a
   * tenant may not share it.
   */
  create(
    registration: WorkspaceRegistration,
    scope: WorkspaceWriteScope
  ): Promise<WorkspaceIdentity>
}

/** The slug of a workspace: the name it is known by in its tenant. */
export const WORKSPACE_SLUG = /^[a-z][a-z0-9_-]{0,62}$/

/** The longest name of a workspace. */
export const WORKSPACE_DISPLAY_NAME_MAX = 200

/**
 * The reason a registration is refused.
 *
 * The reason is a code of the contract of the service: a slug that the
 * tenant already holds is a conflict, and a slug or a name that the
 * registry does not accept is a bad request.
 */
export type WorkspaceRejection = 'invalid_request' | 'conflict'

/** The failure of the creation of a workspace. */
export class WorkspaceCreationError extends Error {
  override readonly name = 'WorkspaceCreationError'
  readonly code: WorkspaceRejection

  constructor(code: WorkspaceRejection, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * Creates the workspaces of the tenants.
 *
 * The service validates the registration and it writes the registry: the
 * rules of a slug and of a name are the rules of the registry, and they
 * are the same in every deployment.
 */
export class WorkspaceCreationService {
  readonly #creator: WorkspaceCreator

  constructor(creator: WorkspaceCreator) {
    this.#creator = creator
  }

  /**
   * Creates a workspace of a tenant.
   *
   * @param registration the workspace to create.
   * @param scope the tenant and the principal of the call.
   */
  async create(
    registration: WorkspaceRegistration,
    scope: WorkspaceWriteScope
  ): Promise<WorkspaceIdentity> {
    if (!WORKSPACE_SLUG.test(registration.slug)) {
      throw new WorkspaceCreationError(
        'invalid_request',
        'the slug of a workspace starts with a letter and holds letters, digits, dashes and underscores'
      )
    }
    const displayName = registration.displayName.trim()
    if (displayName.length === 0 || displayName.length > WORKSPACE_DISPLAY_NAME_MAX) {
      throw new WorkspaceCreationError(
        'invalid_request',
        'the name of a workspace is a text of one to two hundred characters'
      )
    }
    return await this.#creator.create({ ...registration, displayName }, scope)
  }
}
