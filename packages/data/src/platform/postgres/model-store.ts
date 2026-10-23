/**
 * The store of the model of the workspaces (spec §7.7).
 *
 * The model of a workspace is a document: it is read with the narrow
 * reader of the registry, next to the workspace itself, and it is
 * written inside the scope of a transaction of the api, so that the row
 * level security of the table is the isolation of the workspaces.
 *
 * The write is a compare and a set: the version of the model that the
 * caller read is the version the write expects, and a model that
 * changed in between is a conflict and not an overwrite.
 */

import type { CollectionRegistrar, ModelStore } from '../../domains/model'
import { ModelError, type WorkspaceModel, parseWorkspaceModel } from '../../domains/model'
import type { ColumnReader } from '../../domains/model'
import type { ConnectionPool } from './database'
import type { PostgresDataStore } from './scoped'

/** The row of the statement of the model of a workspace. */
interface ModelRow {
  readonly version: number
  readonly model: unknown
}

/** The store of the model of the workspaces, on postgres. */
export class PostgresModelStore implements ModelStore {
  readonly #registry: ConnectionPool
  readonly #data: PostgresDataStore

  constructor(options: { registry: ConnectionPool; data: PostgresDataStore }) {
    this.#registry = options.registry
    this.#data = options.data
  }

  /**
   * Reads the model of a workspace.
   *
   * A workspace that holds no model holds the model of the deployment:
   * the model that changes nothing.
   */
  async read(workspaceId: string): Promise<{ version: number; model: WorkspaceModel } | null> {
    const rows = await this.#registry.query<ModelRow>(
      'select version, model from platform.workspace_models where workspace_id = $1::uuid',
      [workspaceId]
    )
    const row = rows[0]
    if (!row) return null
    return { version: row.version, model: parseWorkspaceModel(row.model) }
  }

  /**
   * Writes the model of a workspace.
   *
   * The write is refused when the model moved since it was read: two
   * administrators of the same workspace never overwrite each other.
   */
  async write(options: {
    workspaceId: string
    tenantId: string
    principalId: string
    model: WorkspaceModel
    expectedVersion: number
  }): Promise<number> {
    const body = JSON.stringify(options.model)
    const scope = {
      tenantId: options.tenantId,
      workspaceId: options.workspaceId,
      principalId: options.principalId,
    }
    return await this.#data.write(async (unit) => {
      const existing = await unit.queryOne<{ version: number }>(
        'select version from platform.workspace_models where workspace_id = $1::uuid for update',
        [options.workspaceId]
      )
      const version = existing?.version ?? 0
      if (version !== options.expectedVersion) {
        throw new ModelError(
          'CONFLICT',
          'the model of the workspace changed since it was read: read it again and write it again'
        )
      }
      const rows = await unit.query<{ version: number }>(
        `insert into platform.workspace_models
           (workspace_id, tenant_id, version, model, updated_at, updated_by)
         values ($1::uuid, $2::uuid, 1, $3::jsonb, now(), $4)
         on conflict (workspace_id) do update
            set version = platform.workspace_models.version + 1,
                model = excluded.model,
                updated_at = now(),
                updated_by = excluded.updated_by
         returning version`,
        [options.workspaceId, options.tenantId, body, options.principalId]
      )
      const row = rows[0]
      if (!row) {
        throw new ModelError('CONFLICT', 'the model of the workspace could not be written')
      }
      return row.version
    }, scope)
  }
}

/** The reader of the columns of the tables of the deployment. */
export class PostgresColumnReader implements ColumnReader {
  readonly #pool: ConnectionPool

  constructor(pool: ConnectionPool) {
    this.#pool = pool
  }

  /**
   * The columns of a table of the deployment.
   *
   * The reader reads the catalog of the database and not the manifest:
   * a column that the deployment holds and that the manifest does not
   * name is a column a model may add.
   */
  async columns(table: string): Promise<readonly { name: string; type: string }[]> {
    const [schema, name] = table.split('.')
    if (!schema || !name) return []
    const rows = await this.#pool.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type
         from information_schema.columns
        where table_schema = $1 and table_name = $2
        order by ordinal_position`,
      [schema, name]
    )
    return rows.map((row) => ({ name: row.column_name, type: row.data_type }))
  }
}

/**
 * The registrar of the collections of a workspace.
 *
 * The registry of the catalog is the configuration of a workspace: the
 * administrator of the workspace writes it, and the role of the api
 * writes it inside the scope of the transaction of the request, so that
 * the row level security of the table is the isolation of the
 * workspaces.
 */
export class PostgresCollectionRegistrar implements CollectionRegistrar {
  readonly #data: PostgresDataStore

  constructor(data: PostgresDataStore) {
    this.#data = data
  }

  /** The collections a workspace registered, and whether it serves them. */
  async registered(
    workspaceId: string,
    tenantId: string
  ): Promise<readonly { key: string; enabled: boolean }[]> {
    const rows = await this.#data.read(
      async (unit) => {
        return await unit.query<{ collection_key: string; enabled: boolean }>(
          `select collection_key, enabled
           from platform.collection_registry
          where workspace_id = $1::uuid
          order by collection_key`,
          [workspaceId]
        )
      },
      { tenantId, workspaceId, principalId: '' }
    )
    return rows.map((row) => ({ key: row.collection_key, enabled: row.enabled }))
  }

  /** Registers a collection for a workspace and enables it. */
  async enable(options: {
    workspaceId: string
    tenantId: string
    key: string
    table: string
    schemaVersion: string
  }): Promise<void> {
    await this.#data.write(
      async (unit) => {
        await unit.execute(
          `insert into platform.collection_registry
           (workspace_id, tenant_id, collection_key, table_name, schema_version, enabled)
         values ($1::uuid, $2::uuid, $3, $4, $5, true)
         on conflict (workspace_id, collection_key) do update
            set table_name = excluded.table_name,
                schema_version = excluded.schema_version,
                enabled = true,
                updated_at = now()`,
          [options.workspaceId, options.tenantId, options.key, options.table, options.schemaVersion]
        )
      },
      {
        tenantId: options.tenantId,
        workspaceId: options.workspaceId,
        principalId: '',
      }
    )
  }

  /** Stops a workspace from serving a collection. */
  async disable(options: { workspaceId: string; tenantId: string; key: string }): Promise<void> {
    await this.#data.write(
      async (unit) => {
        await unit.execute(
          `update platform.collection_registry
            set enabled = false, updated_at = now()
          where workspace_id = $1::uuid and collection_key = $2`,
          [options.workspaceId, options.key]
        )
      },
      {
        tenantId: options.tenantId,
        workspaceId: options.workspaceId,
        principalId: '',
      }
    )
  }
}
