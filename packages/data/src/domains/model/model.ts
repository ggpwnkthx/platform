/**
 * The model of a workspace (spec §7.7).
 *
 * The deployment holds the **physical** model: the tables of its
 * migrations and the manifest that names them. A workspace holds its own
 * **logical** model: the overlay that says how the collections of the
 * deployment look for that workspace — the labels, the constraints, the
 * relations and the fields that are not part of the model at all.
 *
 * The overlay is applied to the manifest of the deployment when the
 * catalog of a workspace is resolved, and it is applied **in realtime**:
 * a change of the overlay is the change of the model of the workspace
 * for every request that follows it. The overlay never creates a table
 * and never alters one: the tables of the deployment are the tables of
 * the deployment, and a field that the overlay adds is a field that the
 * deployment already holds.
 */

import {
  type CollectionDefinition,
  COLLECTION_KEY_PATTERN,
  type FieldDefinition,
  type FieldType,
  type ManifestBundle,
  RELATION_TYPES,
  type RelationDefinition,
  type RelationType,
  contentVersion,
} from '../schema'

/** The version of the format of the model. */
export const MODEL_VERSION = 1

/** The types a field of the model may have. */
export const MODEL_FIELD_TYPES: readonly FieldType[] = [
  'string',
  'text',
  'boolean',
  'integer',
  'decimal',
  'uuid',
  'timestamp',
  'json',
  'enum',
]

/** The problem of a model that cannot be used. */
export class ModelError extends Error {
  override readonly name = 'ModelError'
  /** The stable code of the problem. */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** A field of the model of a workspace. */
export interface ModelField {
  /** The type of the value of the field. */
  readonly type: FieldType
  /** True when a value must be present on a creation. */
  readonly required: boolean
  /** True when the explicit value `null` is accepted. */
  readonly nullable: boolean
  /** The maximum length of a string, in code points. */
  readonly maxLength?: number
  /** The minimum length of a string, in code points. */
  readonly minLength?: number
  /** The values of an enumeration. */
  readonly enum?: readonly string[]
  /** The default of the field, applied by the server. */
  readonly default?: unknown
  /** The smallest value of a number. */
  readonly minimum?: number
  /** The largest value of a number. */
  readonly maximum?: number
  /** The label of the field. */
  readonly label?: string
  /** The description of the field. */
  readonly description?: string
}

/** A relation of the model of a workspace. */
export interface ModelRelation {
  /** The collection the relation points at. */
  readonly target: string
  /** The kind of the relation. */
  readonly type: RelationType
  /** The field that carries the relation. */
  readonly field: string
  /** The label of the relation. */
  readonly label?: string
  /** The description of the relation. */
  readonly description?: string
}

/** The model of one collection of a workspace. */
export interface ModelCollection {
  /** The label of the collection. */
  readonly label?: string
  /** The description of the collection. */
  readonly description?: string
  /** The fields of the collection that the model changes or adds. */
  readonly fields: Readonly<Record<string, ModelField>>
  /** The fields of the deployment that the model does not hold. */
  readonly removed: readonly string[]
  /** The relations of the collection of the model. */
  readonly relations: Readonly<Record<string, ModelRelation>>
  /** The order of the fields of the collection. */
  readonly order: readonly string[]
}

/** The model of a workspace. */
export interface WorkspaceModel {
  /** The version of the format of the model. */
  readonly version: number
  /** The collections of the model, by key. */
  readonly collections: Readonly<Record<string, ModelCollection>>
}

/** A model that changes nothing. */
export function emptyModel(): WorkspaceModel {
  return { version: MODEL_VERSION, collections: {} }
}

/** Reports whether a value is an object and not an array. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Refuses a property that the format does not know. */
function assertKnownKeys(value: Record<string, unknown>, allowed: string[], where: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new ModelError(
      'INVALID_MODEL',
      `${where}: unknown properties: ${unknown.sort().join(', ')}`
    )
  }
}

/** Parses a field of the model. */
function parseModelField(name: string, raw: unknown, where: string): ModelField {
  if (!isObject(raw))
    throw new ModelError('INVALID_MODEL', `${where}: the field "${name}" is not an object`)
  assertKnownKeys(
    raw,
    [
      'type',
      'required',
      'nullable',
      'maxLength',
      'minLength',
      'enum',
      'default',
      'minimum',
      'maximum',
      'label',
      'description',
    ],
    `${where}: the field "${name}"`
  )
  const type = raw.type
  if (typeof type !== 'string' || !(MODEL_FIELD_TYPES as readonly string[]).includes(type)) {
    throw new ModelError('INVALID_MODEL', `${where}: the field "${name}" has an unknown type`)
  }
  const required = raw.required ?? false
  const nullable = raw.nullable ?? true
  if (typeof required !== 'boolean' || typeof nullable !== 'boolean') {
    throw new ModelError('INVALID_MODEL', `${where}: the field "${name}" has a malformed flag`)
  }
  const field: { -readonly [Key in keyof ModelField]: ModelField[Key] } = {
    type: type as FieldType,
    required,
    nullable,
  }
  if (raw.maxLength !== undefined) {
    if (
      typeof raw.maxLength !== 'number' ||
      !Number.isInteger(raw.maxLength) ||
      raw.maxLength < 1
    ) {
      throw new ModelError(
        'INVALID_MODEL',
        `${where}: the field "${name}" has a malformed maxLength`
      )
    }
    field.maxLength = raw.maxLength
  }
  if (raw.minLength !== undefined) {
    if (
      typeof raw.minLength !== 'number' ||
      !Number.isInteger(raw.minLength) ||
      raw.minLength < 0
    ) {
      throw new ModelError(
        'INVALID_MODEL',
        `${where}: the field "${name}" has a malformed minLength`
      )
    }
    field.minLength = raw.minLength
  }
  if (raw.enum !== undefined) {
    if (
      !Array.isArray(raw.enum) ||
      raw.enum.length === 0 ||
      raw.enum.some((value) => typeof value !== 'string')
    ) {
      throw new ModelError(
        'INVALID_MODEL',
        `${where}: the field "${name}" has a malformed enumeration`
      )
    }
    field.enum = raw.enum as string[]
  }
  if (raw.default !== undefined) field.default = raw.default
  if (raw.minimum !== undefined) {
    if (typeof raw.minimum !== 'number' || !Number.isFinite(raw.minimum)) {
      throw new ModelError('INVALID_MODEL', `${where}: the field "${name}" has a malformed minimum`)
    }
    field.minimum = raw.minimum
  }
  if (raw.maximum !== undefined) {
    if (typeof raw.maximum !== 'number' || !Number.isFinite(raw.maximum)) {
      throw new ModelError('INVALID_MODEL', `${where}: the field "${name}" has a malformed maximum`)
    }
    field.maximum = raw.maximum
  }
  if (raw.label !== undefined) {
    if (typeof raw.label !== 'string') {
      throw new ModelError('INVALID_MODEL', `${where}: the field "${name}" has a malformed label`)
    }
    field.label = raw.label
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') {
      throw new ModelError(
        'INVALID_MODEL',
        `${where}: the field "${name}" has a malformed description`
      )
    }
    field.description = raw.description
  }
  if (field.type === 'enum' && !field.enum) {
    throw new ModelError(
      'INVALID_MODEL',
      `${where}: the field "${name}" is an enumeration without its values`
    )
  }
  if (field.type !== 'enum' && field.enum) {
    throw new ModelError(
      'INVALID_MODEL',
      `${where}: the field "${name}" is not an enumeration and holds values`
    )
  }
  if (field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum) {
    throw new ModelError(
      'INVALID_MODEL',
      `${where}: the field "${name}" has a minimum above its maximum`
    )
  }
  return field
}

/** Parses a relation of the model. */
function parseModelRelation(name: string, raw: unknown, where: string): ModelRelation {
  if (!isObject(raw)) {
    throw new ModelError('INVALID_MODEL', `${where}: the relation "${name}" is not an object`)
  }
  assertKnownKeys(
    raw,
    ['target', 'type', 'field', 'label', 'description'],
    `${where}: the relation "${name}"`
  )
  const target = raw.target
  const type = raw.type
  const field = raw.field
  if (typeof target !== 'string' || !COLLECTION_KEY_PATTERN.test(target)) {
    throw new ModelError('INVALID_MODEL', `${where}: the relation "${name}" has an invalid target`)
  }
  if (typeof type !== 'string' || !(RELATION_TYPES as readonly string[]).includes(type)) {
    throw new ModelError('INVALID_MODEL', `${where}: the relation "${name}" has an unknown type`)
  }
  if (typeof field !== 'string' || !COLLECTION_KEY_PATTERN.test(field)) {
    throw new ModelError('INVALID_MODEL', `${where}: the relation "${name}" has an invalid field`)
  }
  const relation: { -readonly [Key in keyof ModelRelation]: ModelRelation[Key] } = {
    target,
    type: type as RelationType,
    field,
  }
  if (raw.label !== undefined) {
    if (typeof raw.label !== 'string') {
      throw new ModelError(
        'INVALID_MODEL',
        `${where}: the relation "${name}" has a malformed label`
      )
    }
    relation.label = raw.label
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') {
      throw new ModelError(
        'INVALID_MODEL',
        `${where}: the relation "${name}" has a malformed description`
      )
    }
    relation.description = raw.description
  }
  return relation
}

/** Parses the model of a collection. */
function parseModelCollection(key: string, raw: unknown): ModelCollection {
  const where = `the collection "${key}" of the model`
  if (!isObject(raw)) throw new ModelError('INVALID_MODEL', `${where} is not an object`)
  assertKnownKeys(raw, ['label', 'description', 'fields', 'removed', 'relations', 'order'], where)
  const collection: {
    -readonly [Key in keyof ModelCollection]: ModelCollection[Key]
  } = { fields: {}, removed: [], relations: {}, order: [] }
  if (raw.label !== undefined) {
    if (typeof raw.label !== 'string' || raw.label.length === 0) {
      throw new ModelError('INVALID_MODEL', `${where} has a malformed label`)
    }
    collection.label = raw.label
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') {
      throw new ModelError('INVALID_MODEL', `${where} has a malformed description`)
    }
    collection.description = raw.description
  }
  if (raw.fields !== undefined) {
    if (!isObject(raw.fields)) {
      throw new ModelError('INVALID_MODEL', `${where} has malformed fields`)
    }
    const fields: Record<string, ModelField> = {}
    for (const [name, definition] of Object.entries(raw.fields)) {
      if (!COLLECTION_KEY_PATTERN.test(name)) {
        throw new ModelError('INVALID_MODEL', `${where} has an invalid field name`)
      }
      fields[name] = parseModelField(name, definition, where)
    }
    collection.fields = fields
  }
  if (raw.removed !== undefined) {
    if (!Array.isArray(raw.removed) || raw.removed.some((name) => typeof name !== 'string')) {
      throw new ModelError('INVALID_MODEL', `${where} has a malformed list of removed fields`)
    }
    collection.removed = raw.removed as string[]
  }
  if (raw.relations !== undefined) {
    if (!isObject(raw.relations)) {
      throw new ModelError('INVALID_MODEL', `${where} has malformed relations`)
    }
    const relations: Record<string, ModelRelation> = {}
    for (const [name, definition] of Object.entries(raw.relations)) {
      if (!COLLECTION_KEY_PATTERN.test(name)) {
        throw new ModelError('INVALID_MODEL', `${where} has an invalid relation name`)
      }
      relations[name] = parseModelRelation(name, definition, where)
    }
    collection.relations = relations
  }
  if (raw.order !== undefined) {
    if (!Array.isArray(raw.order) || raw.order.some((name) => typeof name !== 'string')) {
      throw new ModelError('INVALID_MODEL', `${where} has a malformed order`)
    }
    collection.order = raw.order as string[]
  }
  return collection
}

/**
 * Parses the model of a workspace.
 *
 * The model is refused as a whole: a model that holds half of a change
 * is a model that nobody can reason about.
 */
export function parseWorkspaceModel(raw: unknown): WorkspaceModel {
  if (!isObject(raw)) throw new ModelError('INVALID_MODEL', 'the model is not an object')
  assertKnownKeys(raw, ['version', 'collections'], 'the model')
  if (raw.version !== MODEL_VERSION) {
    throw new ModelError('INVALID_MODEL', `the model must have the version ${MODEL_VERSION}`)
  }
  if (!isObject(raw.collections)) {
    throw new ModelError('INVALID_MODEL', 'the model has malformed collections')
  }
  const collections: Record<string, ModelCollection> = {}
  for (const [key, definition] of Object.entries(raw.collections)) {
    if (!COLLECTION_KEY_PATTERN.test(key)) {
      throw new ModelError('INVALID_MODEL', 'the model has an invalid collection key')
    }
    collections[key] = parseModelCollection(key, definition)
  }
  return { version: MODEL_VERSION, collections }
}

/** The digest of the content of a model. */
export function modelVersion(model: WorkspaceModel): string {
  return contentVersion(model)
}

/** The model with a collection that carries the given attributes. */
export function withCollection(
  model: WorkspaceModel,
  key: string,
  attributes: { readonly label?: string; readonly description?: string }
): WorkspaceModel {
  const current = model.collections[key] ?? {
    fields: {},
    removed: [],
    relations: {},
    order: [],
  }
  const next: ModelCollection = {
    ...current,
    ...(attributes.label !== undefined ? { label: attributes.label } : {}),
    ...(attributes.description !== undefined ? { description: attributes.description } : {}),
  }
  return { ...model, collections: { ...model.collections, [key]: next } }
}

/** The model with a field of a collection. */
export function withField(
  model: WorkspaceModel,
  key: string,
  name: string,
  field: ModelField
): WorkspaceModel {
  const current = model.collections[key] ?? {
    fields: {},
    removed: [],
    relations: {},
    order: [],
  }
  const fields = { ...current.fields, [name]: field }
  const removed = current.removed.filter((entry) => entry !== name)
  const order = current.order.includes(name) ? current.order : [...current.order, name]
  return {
    ...model,
    collections: {
      ...model.collections,
      [key]: { ...current, fields, removed, order },
    },
  }
}

/** The model without a field of a collection. */
export function withoutField(model: WorkspaceModel, key: string, name: string): WorkspaceModel {
  const current = model.collections[key] ?? {
    fields: {},
    removed: [],
    relations: {},
    order: [],
  }
  const fields = { ...current.fields }
  delete fields[name]
  const removed = current.removed.includes(name) ? current.removed : [...current.removed, name]
  const order = current.order.filter((entry) => entry !== name)
  return {
    ...model,
    collections: {
      ...model.collections,
      [key]: { ...current, fields, removed, order },
    },
  }
}

/**
 * The model with the fields of a collection in another order.
 *
 * The order is the order the reader sees: the fields of the manifest
 * of the deployment come first, and the model moves them.
 */
export function withOrder(
  model: WorkspaceModel,
  key: string,
  order: readonly string[]
): WorkspaceModel {
  const current = model.collections[key] ?? {
    fields: {},
    removed: [],
    relations: {},
    order: [],
  }
  return {
    ...model,
    collections: {
      ...model.collections,
      [key]: { ...current, order: [...order] },
    },
  }
}

/** The model with a relation of a collection. */
export function withRelation(
  model: WorkspaceModel,
  key: string,
  name: string,
  relation: ModelRelation
): WorkspaceModel {
  const current = model.collections[key] ?? {
    fields: {},
    removed: [],
    relations: {},
    order: [],
  }
  return {
    ...model,
    collections: {
      ...model.collections,
      [key]: { ...current, relations: { ...current.relations, [name]: relation } },
    },
  }
}

/** The model without a relation of a collection. */
export function withoutRelation(model: WorkspaceModel, key: string, name: string): WorkspaceModel {
  const current = model.collections[key]
  if (!current) return model
  const relations = { ...current.relations }
  delete relations[name]
  return {
    ...model,
    collections: { ...model.collections, [key]: { ...current, relations } },
  }
}

/** The fields of the model, in the order of the model. */
function orderedFields(
  collection: CollectionDefinition,
  overlay: ModelCollection | undefined
): Record<string, FieldDefinition> {
  const definition = collection.fields
  const fields: Record<string, FieldDefinition> = {}
  const removed = new Set(overlay?.removed ?? [])
  const overrides = overlay?.fields ?? {}
  const names = [
    ...Object.keys(definition),
    ...Object.keys(overrides).filter((name) => !(name in definition)),
  ]
  const order = overlay?.order ?? []
  const ordered = [
    ...order.filter((name) => names.includes(name)),
    ...names.filter((name) => !order.includes(name)),
  ]
  for (const name of ordered) {
    if (removed.has(name)) continue
    const base = definition[name]
    const override = overrides[name]
    if (!base && !override) continue
    fields[name] = base && override ? { ...base, ...definedOnly(override) } : (override ?? base)!
  }
  return fields
}

/** The attributes of an override that are set. */
export function definedOnly(field: ModelField): Partial<FieldDefinition> {
  const attributes: {
    -readonly [Key in keyof FieldDefinition]?: FieldDefinition[Key]
  } = {}
  if (field.required !== undefined) attributes.required = field.required
  if (field.nullable !== undefined) attributes.nullable = field.nullable
  if (field.maxLength !== undefined) attributes.maxLength = field.maxLength
  if (field.minLength !== undefined) attributes.minLength = field.minLength
  if (field.enum !== undefined) attributes.enum = field.enum
  if (field.default !== undefined) attributes.default = field.default
  if (field.minimum !== undefined) attributes.minimum = field.minimum
  if (field.maximum !== undefined) attributes.maximum = field.maximum
  if (field.label !== undefined) attributes.label = field.label
  if (field.description !== undefined) attributes.description = field.description
  return attributes
}

/** The relations of the model of a collection. */
function relationsOf(
  collection: CollectionDefinition,
  overlay: ModelCollection | undefined
): Record<string, RelationDefinition> {
  const relations: Record<string, RelationDefinition> = { ...collection.relations }
  for (const [name, relation] of Object.entries(overlay?.relations ?? {})) {
    relations[name] = {
      target: relation.target,
      type: relation.type,
      field: relation.field,
      ...(relation.label !== undefined ? { label: relation.label } : {}),
      ...(relation.description !== undefined ? { description: relation.description } : {}),
    }
  }
  return relations
}

/**
 * Applies the model of a workspace to the manifest of the deployment.
 *
 * The result is the manifest the workspace serves: the collections the
 * workspace registered, with the fields, the labels, the constraints and
 * the relations the model of the workspace holds.
 */
export function applyModel(manifest: ManifestBundle, model: WorkspaceModel): ManifestBundle {
  if (Object.keys(model.collections).length === 0) return manifest
  const collections = manifest.collections.map((collection) => {
    const overlay = model.collections[collection.key]
    if (!overlay) return collection
    return {
      ...collection,
      ...(overlay.label !== undefined ? { label: overlay.label } : {}),
      ...(overlay.description !== undefined ? { description: overlay.description } : {}),
      fields: orderedFields(collection, overlay),
      relations: relationsOf(collection, overlay),
    }
  })
  const changed = collections.some(
    (collection, index) => collection !== manifest.collections[index]
  )
  if (!changed) return manifest
  return {
    version: manifest.version,
    schemaVersion: manifest.schemaVersion,
    collections,
    bundleVersion: contentVersion({
      version: manifest.version,
      schemaVersion: manifest.schemaVersion,
      collections,
    }),
  }
}

/**
 * The version of the schema of a model.
 *
 * The version of the schema of a workspace names the model it serves: a
 * workspace whose model changed serves another schema, and the cursors
 * of the old one are refused.
 */
export function schemaVersionOf(manifest: ManifestBundle, model: WorkspaceModel): string {
  if (Object.keys(model.collections).length === 0) return manifest.schemaVersion
  return `${manifest.schemaVersion}.m${modelVersion(model).slice(0, 12)}`
}
