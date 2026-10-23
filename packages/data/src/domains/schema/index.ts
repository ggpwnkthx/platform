/**
 * The schema domain (spec §7).
 *
 * The public entry point of the domain: the manifest of the deployment
 * and the vocabulary of the fields and the relations.
 */

export {
  COLLECTION_KEY_PATTERN,
  type CollectionDefinition,
  type FieldDefinition,
  type FieldType,
  type ManifestBundle,
  RELATION_TYPES,
  type RelationDefinition,
  type RelationType,
  canonicalJson,
  contentVersion,
  isTimestamp,
  parseManifestBundle,
} from './manifest'
