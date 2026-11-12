/**
 * The write of the registry of the workspaces (spec §6.1 and §9.11).
 *
 * The registry is written by the role of the api, inside the scope of
 * the tenant of the workspace: the row level security of the registry
 * refuses a row that names another tenant, and a write without a scope
 * sees nothing.
 *
 * The write is one statement, and it is the only statement the role of
 * the api makes on the registry: the operator command that creates a
 * workspace writes it with the owner of the schema, and this one writes
 * it with the role that serves the calls of the tenants.
 */

import {
  WorkspaceCreationError,
  type WorkspaceCreator,
  type WorkspaceIdentity,
  type WorkspaceRegistration,
  type WorkspaceWriteScope,
} from '../../domains/workspaces'
import type { DataStore } from '../../domains/records'
import { ServiceError } from '../../protocol/errors'

/** The row of the statement of the creation. */
interface CreatedWorkspaceRow {
  readonly id: string
  readonly tenant_id: string
  readonly slug: string
  readonly display_name: string
  readonly status: string
}

/**
 * The statement of the creation of a workspace.
 *
 * The slug of a workspace is unique in its tenant: a slug that the tenant
 * already holds is a conflict, and the statement refuses it with the
 * unique index of the registry.
 */
const CREATE_WORKSPACE = `
  insert into platform.workspaces (id, tenant_id, slug, display_name, status)
  values ($1::uuid, $2::uuid, $3, $4, 'active')
  returning id, tenant_id, slug, display_name, status`

/** The writer of the registry of the workspaces. */
export class PostgresWorkspaceCreator implements WorkspaceCreator {
  readonly #store: DataStore

  constructor(store: DataStore) {
    this.#store = store
  }

  /**
   * Creates a workspace of a tenant.
   *
   * The write is a transaction of the runtime, and it carries the scope
   * of the tenant: the registry refuses a row that names another tenant.
   */
  async create(
    registration: WorkspaceRegistration,
    scope: WorkspaceWriteScope
  ): Promise<WorkspaceIdentity> {
    try {
      const row = await this.#store.write(
        async (unit) =>
          await unit.queryOne<CreatedWorkspaceRow>(CREATE_WORKSPACE, [
            registration.id,
            registration.tenantId,
            registration.slug,
            registration.displayName,
          ]),
        {
          tenantId: scope.tenantId,
          // The workspace is the one that is created: it does not exist
          // yet, and the scope of a write of the registry carries the
          // tenant alone.
          workspaceId: '',
          principalId: scope.principalId,
        }
      )
      if (!row) {
        throw new WorkspaceCreationError('conflict', 'the workspace could not be created')
      }
      return {
        id: row.id,
        tenantId: row.tenant_id,
        status: row.status === 'disabled' ? 'disabled' : 'active',
        slug: row.slug,
        displayName: row.display_name,
      }
    } catch (error) {
      // The unique index of the slug is the conflict of the contract: the
      // slug is the name of the workspace inside its tenant.
      if (error instanceof ServiceError && error.code === 'CONFLICT') {
        throw new WorkspaceCreationError(
          'conflict',
          'the tenant already holds a workspace with this slug'
        )
      }
      throw error
    }
  }
}
