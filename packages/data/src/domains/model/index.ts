/**
 * The model of a workspace (spec §7.6).
 *
 * The public entry point of the domain: the overlay that says how the
 * collections of the deployment look for a workspace, the service that
 * changes it, and the ports it reads and writes through.
 */

export {
  ModelError,
  type WorkspaceModel,
  applyModel,
  emptyModel,
  parseWorkspaceModel,
  schemaVersionOf,
} from './model'
export {
  type CollectionRegistrar,
  type ColumnReader,
  type ModelScope,
  type ModelStore,
  ModelService,
} from './service'
