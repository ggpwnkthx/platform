/**
 * The shapes of the contract of `v1` of Data, as the console reads them
 * (docs/data/api.md).
 *
 * The shapes are written in the client of the platform
 * (`@platform/client`): the console and the CLI read the same
 * contracts, and a shape that is written twice is a shape that drifts.
 */

export type {
  Aggregate,
  AuditEntry,
  CollectionMetadata,
  FieldAttributes,
  FieldMetadata,
  Me,
  Model,
  ModelCollection,
  ModelField,
  Page,
  RecordValue,
  RelationAttributes,
  SchemaMetadata,
  VersionEntry,
} from '@platform/client'
