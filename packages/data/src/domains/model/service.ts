/**
 * The service of the model of a workspace (spec §7.7).
 *
 * The service owns the changes of the logical model of a workspace: it
 * reads the model, it refuses the changes that cannot hold, it writes
 * the model and it answers with the model that applies.
 *
 * The service never creates a table and never alters one. A field that
 * the model adds is a column that the deployment already holds, and the
 * service reads the columns of the table of the collection to know it.
 */

import type {
  CollectionDefinition,
  FieldDefinition,
  FieldType,
  ManifestBundle,
  RelationType,
} from '../schema'
import {
  type ModelCollection,
  type ModelField,
  ModelError,
  type WorkspaceModel,
  definedOnly,
  emptyModel,
  modelVersion,
  withCollection,
  withField,
  withOrder,
  withRelation,
  withoutField,
  withoutRelation,
} from './model'

/** The store of the model of a workspace: a port of the platform. */
export interface ModelStore {
  /** Reads the model of a workspace. */
  read: (workspaceId: string) => Promise<{ version: number; model: WorkspaceModel } | null>
  /** Writes the model of a workspace and answers with the new version. */
  write: (options: {
    workspaceId: string
    tenantId: string
    principalId: string
    model: WorkspaceModel
    expectedVersion: number
  }) => Promise<number>
}

/** The reader of the columns of a table: a port of the platform. */
export interface ColumnReader {
  /** The columns of a table of the deployment. */
  columns: (table: string) => Promise<readonly { name: string; type: string }[]>
}

/** The registrar of the collections of a workspace: a port of the platform. */
export interface CollectionRegistrar {
  /** The collections a workspace registered, and whether it serves them. */
  registered: (
    workspaceId: string,
    tenantId: string
  ) => Promise<readonly { key: string; enabled: boolean }[]>
  /** Registers a collection for a workspace and enables it. */
  enable: (options: {
    workspaceId: string
    tenantId: string
    key: string
    table: string
    schemaVersion: string
  }) => Promise<void>
  /** Stops a workspace from serving a collection. */
  disable: (options: { workspaceId: string; tenantId: string; key: string }) => Promise<void>
}

/** The reader of the catalog of a workspace: a port of the platform. */
export interface ServedCollections {
  /** The keys of the collections a workspace serves. */
  served: (workspaceId: string) => Promise<readonly string[]>
}

/** The options of the service of the model. */
export interface ModelServiceOptions {
  /** The manifest of the deployment. */
  readonly deployment: ManifestBundle
  /** The store of the model. */
  readonly store: ModelStore
  /** The reader of the columns of the tables. */
  readonly columns: ColumnReader
  /** The reader of the collections a workspace serves. */
  readonly served: ServedCollections
  /** The registrar of the collections of a workspace. */
  readonly registrar: CollectionRegistrar
}

/** The scope of a change of the model. */
export interface ModelScope {
  readonly tenantId: string
  readonly workspaceId: string
  readonly principalId: string
}

/** The field of the model, as the interface of the service sees it. */
export interface ModelFieldDocument {
  readonly name: string
  readonly type: FieldType
  readonly required: boolean
  readonly nullable: boolean
  readonly label?: string
  readonly description?: string
  readonly enum?: readonly string[]
  readonly default?: unknown
  readonly minimum?: number
  readonly maximum?: number
  readonly maxLength?: number
  readonly minLength?: number
  /** True when the field comes from the manifest of the deployment. */
  readonly deployment: boolean
  /** True when the model of the workspace holds the field. */
  readonly held: boolean
}

/** The relation of the model, as the interface of the service sees it. */
export interface ModelRelationDocument {
  readonly name: string
  readonly target: string
  readonly type: RelationType
  readonly field: string
  readonly label?: string
  readonly description?: string
  /** True when the relation comes from the manifest of the deployment. */
  readonly deployment: boolean
}

/** The collection of the model, as the interface of the service sees it. */
export interface ModelCollectionDocument {
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly table: string
  readonly fields: readonly ModelFieldDocument[]
  readonly relations: readonly ModelRelationDocument[]
  /** The version of the schema the collection serves. */
  readonly schemaVersion: string
}

/** The model of a workspace, as the interface of the service sees it. */
export interface ModelDocument {
  /** The version of the model of the workspace. */
  readonly version: number
  /** The digest of the content of the model. */
  readonly modelVersion: string
  /** The version of the schema the workspace serves. */
  readonly schemaVersion: string
  /** The collections the workspace serves. */
  readonly collections: readonly ModelCollectionDocument[]
  /** The collections of the deployment the workspace does not serve. */
  readonly available: readonly {
    readonly key: string
    readonly label: string
    readonly table: string
  }[]
}

/** The attributes of a field that a change may carry. */
export interface FieldAttributes {
  readonly type?: FieldType
  readonly required?: boolean
  readonly nullable?: boolean
  readonly label?: string
  readonly description?: string
  readonly enum?: readonly string[]
  readonly default?: unknown
  readonly minimum?: number
  readonly maximum?: number
  readonly maxLength?: number
  readonly minLength?: number
}

/** The attributes of a relation that a change may carry. */
export interface RelationAttributes {
  readonly target: string
  readonly type: RelationType
  readonly field: string
  readonly label?: string
  readonly description?: string
}

/** The types a column of the database may hold. */
const COLUMN_TYPES: Readonly<Record<string, readonly FieldType[]>> = {
  text: ['string', 'text'],
  varchar: ['string', 'text'],
  char: ['string'],
  uuid: ['uuid'],
  boolean: ['boolean'],
  integer: ['integer'],
  bigint: ['integer'],
  smallint: ['integer'],
  numeric: ['decimal'],
  decimal: ['decimal'],
  real: ['decimal'],
  double: ['decimal'],
  'timestamp with time zone': ['timestamp'],
  'timestamp without time zone': ['timestamp'],
  timestamptz: ['timestamp'],
  date: ['timestamp'],
  json: ['json'],
  jsonb: ['json'],
}

/** The service of the model of a workspace. */
export class ModelService {
  readonly #options: ModelServiceOptions

  constructor(options: ModelServiceOptions) {
    this.#options = options
  }

  /** The collection of the deployment. */
  #collection(key: string): CollectionDefinition | undefined {
    return this.#options.deployment.collections.find((entry) => entry.key === key)
  }

  /** The model of a workspace, as it is stored. */
  async #read(workspaceId: string): Promise<{ version: number; model: WorkspaceModel }> {
    const found = await this.#options.store.read(workspaceId)
    if (!found) return { version: 0, model: emptyModel() }
    return { version: found.version, model: found.model }
  }

  /**
   * Writes a model of a workspace.
   *
   * The write is refused when the model changed since it was read: two
   * administrators of the same workspace never overwrite each other.
   */
  async #write(scope: ModelScope, model: WorkspaceModel, expectedVersion: number): Promise<number> {
    try {
      return await this.#options.store.write({
        workspaceId: scope.workspaceId,
        tenantId: scope.tenantId,
        principalId: scope.principalId,
        model,
        expectedVersion,
      })
    } catch (error) {
      if (error instanceof ModelError) throw error
      throw error
    }
  }

  /**
   * The model of a workspace, as the interface of the service sees it.
   *
   * The document holds the collections the workspace serves, the fields
   * of the deployment that the model hides, and the collections of the
   * deployment that the workspace does not serve yet.
   */
  async describe(
    workspaceId: string,
    schemaVersion: string,
    served: readonly string[]
  ): Promise<ModelDocument> {
    const { version, model } = await this.#read(workspaceId)
    const overlay = model.collections
    const collections: ModelCollectionDocument[] = []
    for (const collection of this.#options.deployment.collections) {
      if (!served.includes(collection.key)) continue
      const of = overlay[collection.key]
      const fields: ModelFieldDocument[] = []
      const names = [
        ...Object.keys(collection.fields),
        ...Object.keys(of?.fields ?? {}).filter((name) => !(name in collection.fields)),
      ]
      for (const name of names) {
        const deployment = collection.fields[name]
        const override = of?.fields?.[name]
        const definition = deployment
          ? { ...deployment, ...(override ? definedOnly(override) : {}) }
          : override
        if (!definition) continue
        fields.push({
          name,
          type: definition.type,
          required: definition.required,
          nullable: definition.nullable,
          ...(definition.label !== undefined ? { label: definition.label } : {}),
          ...(definition.description !== undefined ? { description: definition.description } : {}),
          ...(definition.enum !== undefined ? { enum: definition.enum } : {}),
          ...(definition.default !== undefined ? { default: definition.default } : {}),
          ...(definition.minimum !== undefined ? { minimum: definition.minimum } : {}),
          ...(definition.maximum !== undefined ? { maximum: definition.maximum } : {}),
          ...(definition.maxLength !== undefined ? { maxLength: definition.maxLength } : {}),
          ...(definition.minLength !== undefined ? { minLength: definition.minLength } : {}),
          deployment: deployment !== undefined,
          held: !of?.removed?.includes(name),
        })
      }
      const relations: ModelRelationDocument[] = []
      const names_ = [
        ...Object.keys(collection.relations),
        ...Object.keys(of?.relations ?? {}).filter((name) => !(name in collection.relations)),
      ]
      for (const name of names_) {
        const deploymentRelation = collection.relations[name]
        const relation = deploymentRelation ?? of?.relations?.[name]
        if (!relation) continue
        relations.push({
          name,
          target: relation.target,
          type: relation.type,
          field: relation.field,
          ...(relation.label !== undefined ? { label: relation.label } : {}),
          ...(relation.description !== undefined ? { description: relation.description } : {}),
          deployment: deploymentRelation !== undefined,
        })
      }
      collections.push({
        key: collection.key,
        label: of?.label ?? collection.label,
        ...((of?.description ?? collection.description)
          ? { description: of?.description ?? collection.description }
          : {}),
        table: collection.table,
        fields,
        relations,
        schemaVersion,
      })
    }
    const available = this.#options.deployment.collections
      .filter((collection) => !collections.some((entry) => entry.key === collection.key))
      .map((collection) => ({
        key: collection.key,
        label: collection.label,
        table: collection.table,
      }))
    return {
      version,
      modelVersion: modelVersion(model),
      schemaVersion,
      collections,
      available,
    }
  }

  /**
   * Registers a collection of the deployment for a workspace.
   *
   * The registration is logical: the collection names a table that the
   * deployment declares, and the workspace serves it from now on. A
   * workspace that registered nothing serves every collection of the
   * deployment, and the first registration writes them all: a
   * registration never narrows a workspace by accident.
   */
  async registerCollection(scope: ModelScope, key: string): Promise<void> {
    const collection = this.#collection(key)
    if (!collection) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" is not declared by the deployment`)
    }
    const registered = await this.#options.registrar.registered(scope.workspaceId, scope.tenantId)
    if (registered.length === 0) {
      for (const entry of this.#options.deployment.collections) {
        await this.#options.registrar.enable({
          workspaceId: scope.workspaceId,
          tenantId: scope.tenantId,
          key: entry.key,
          table: entry.table,
          schemaVersion: this.#options.deployment.schemaVersion,
        })
      }
      return
    }
    await this.#options.registrar.enable({
      workspaceId: scope.workspaceId,
      tenantId: scope.tenantId,
      key: collection.key,
      table: collection.table,
      schemaVersion: this.#options.deployment.schemaVersion,
    })
  }

  /**
   * Stops a workspace from serving a collection.
   *
   * The collection stays registered and it keeps its table: the
   * workspace stops serving it, and it may serve it again.
   */
  async unregisterCollection(scope: ModelScope, key: string): Promise<void> {
    const collection = this.#collection(key)
    if (!collection) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" is not declared by the deployment`)
    }
    const registered = await this.#options.registrar.registered(scope.workspaceId, scope.tenantId)
    if (registered.length === 0) {
      for (const entry of this.#options.deployment.collections) {
        await this.#options.registrar.enable({
          workspaceId: scope.workspaceId,
          tenantId: scope.tenantId,
          key: entry.key,
          table: entry.table,
          schemaVersion: this.#options.deployment.schemaVersion,
        })
      }
    }
    await this.#options.registrar.disable({
      workspaceId: scope.workspaceId,
      tenantId: scope.tenantId,
      key: collection.key,
    })
  }

  /** Changes the label or the description of a collection. */
  async setCollection(
    scope: ModelScope,
    key: string,
    attributes: { readonly label?: string; readonly description?: string }
  ): Promise<number> {
    const collection = this.#collection(key)
    if (!collection) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" is not declared by the deployment`)
    }
    if (attributes.label !== undefined && attributes.label.trim().length === 0) {
      throw new ModelError('INVALID_MODEL', 'the label of a collection is not empty')
    }
    const { version, model } = await this.#read(scope.workspaceId)
    const next = withCollection(model, key, {
      ...(attributes.label !== undefined ? { label: attributes.label.trim() } : {}),
      ...(attributes.description !== undefined ? { description: attributes.description } : {}),
    })
    return await this.#write(scope, next, version)
  }

  /**
   * Adds a field to a collection.
   *
   * The field is a column of the table of the collection: the
   * deployment holds the tables, and a field of the model that names no
   * column is a field that no record can hold.
   */
  async addField(
    scope: ModelScope,
    key: string,
    name: string,
    attributes: FieldAttributes
  ): Promise<number> {
    const collection = this.#collection(key)
    if (!collection) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" is not declared by the deployment`)
    }
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
      throw new ModelError('INVALID_MODEL', `the name "${name}" is not the name of a field`)
    }
    if (SERVER_FIELDS.has(name)) {
      throw new ModelError('INVALID_MODEL', `the field "${name}" is maintained by the server`)
    }
    const { version, model } = await this.#read(scope.workspaceId)
    const held = model.collections[key]?.fields?.[name]
    if (held || collection.fields[name]) {
      throw new ModelError(
        'INVALID_MODEL',
        `the collection "${key}" already holds the field "${name}"`
      )
    }
    const type = attributes.type ?? 'string'
    await this.#checkColumn(collection, name, type)
    const field = this.#fieldOf(type, attributes)
    const next = withField(model, key, name, field)
    return await this.#write(scope, next, version)
  }

  /**
   * Changes a field of a collection.
   *
   * The type of a field of the deployment is the type of its column:
   * the model never changes it.
   */
  async changeField(
    scope: ModelScope,
    key: string,
    name: string,
    attributes: FieldAttributes
  ): Promise<number> {
    const collection = this.#collection(key)
    if (!collection) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" is not declared by the deployment`)
    }
    const { version, model } = await this.#read(scope.workspaceId)
    const current = model.collections[key]?.fields?.[name] ?? collection.fields[name]
    if (!current) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" holds no field "${name}"`)
    }
    if (attributes.type !== undefined && attributes.type !== current.type) {
      throw new ModelError(
        'INVALID_MODEL',
        `the type of the field "${name}" is the type of its column and it never changes`
      )
    }
    const field = this.#fieldOf(current.type, { ...current, ...attributes })
    const next = withField(model, key, name, field)
    return await this.#write(scope, next, version)
  }

  /** Removes a field of the model of a collection. */
  async removeField(scope: ModelScope, key: string, name: string): Promise<number> {
    const collection = this.#collection(key)
    if (!collection) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" is not declared by the deployment`)
    }
    const { version, model } = await this.#read(scope.workspaceId)
    const overlay = model.collections[key]
    if (!overlay?.fields?.[name] && !collection.fields[name]) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" holds no field "${name}"`)
    }
    const used = this.#relationsUsing(collection, overlay, name)
    if (used.length > 0) {
      throw new ModelError(
        'INVALID_MODEL',
        `the relation "${used[0]}" of the collection "${key}" uses the field "${name}"`
      )
    }
    const next = withoutField(model, key, name)
    return await this.#write(scope, next, version)
  }

  /**
   * Moves a field of a collection in the order of the model.
   *
   * The order is the order the reader sees: the model moves the fields
   * of the collection, and it never adds one and never removes one.
   */
  async moveField(
    scope: ModelScope,
    key: string,
    name: string,
    direction: 'up' | 'down'
  ): Promise<number> {
    const collection = this.#collection(key)
    if (!collection) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" is not declared by the deployment`)
    }
    const { version, model } = await this.#read(scope.workspaceId)
    const overlay = model.collections[key]
    const names = [
      ...Object.keys(collection.fields),
      ...Object.keys(overlay?.fields ?? {}).filter((entry) => !(entry in collection.fields)),
    ]
    const order = [
      ...(overlay?.order ?? []).filter((entry) => names.includes(entry)),
      ...names.filter((entry) => !(overlay?.order ?? []).includes(entry)),
    ]
    const index = order.indexOf(name)
    if (index < 0) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" holds no field "${name}"`)
    }
    const other = direction === 'up' ? index - 1 : index + 1
    if (other < 0 || other >= order.length) return version
    const moved = [...order]
    const [entry] = moved.splice(index, 1)
    moved.splice(other, 0, entry!)
    const next = withOrder(model, key, moved)
    return await this.#write(scope, next, version)
  }

  /** Adds a relation to a collection. */
  async addRelation(
    scope: ModelScope,
    key: string,
    name: string,
    attributes: RelationAttributes
  ): Promise<number> {
    const collection = this.#collection(key)
    if (!collection) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" is not declared by the deployment`)
    }
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
      throw new ModelError('INVALID_MODEL', `the name "${name}" is not the name of a relation`)
    }
    const { version, model } = await this.#read(scope.workspaceId)
    const overlay = model.collections[key]
    if (collection.relations[name] || overlay?.relations?.[name]) {
      throw new ModelError(
        'INVALID_MODEL',
        `the collection "${key}" already holds the relation "${name}"`
      )
    }
    await this.#checkRelation(scope, collection, overlay, name, attributes)
    const next = withRelation(model, key, name, {
      target: attributes.target,
      type: attributes.type,
      field: attributes.field,
      ...(attributes.label !== undefined ? { label: attributes.label } : {}),
      ...(attributes.description !== undefined ? { description: attributes.description } : {}),
    })
    return await this.#write(scope, next, version)
  }

  /** Changes a relation of a collection. */
  async changeRelation(
    scope: ModelScope,
    key: string,
    name: string,
    attributes: RelationAttributes
  ): Promise<number> {
    const collection = this.#collection(key)
    if (!collection) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" is not declared by the deployment`)
    }
    const { version, model } = await this.#read(scope.workspaceId)
    const overlay = model.collections[key]
    const current = overlay?.relations?.[name] ?? collection.relations[name]
    if (!current) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" holds no relation "${name}"`)
    }
    await this.#checkRelation(scope, collection, overlay, name, attributes)
    const next = withRelation(model, key, name, {
      target: attributes.target,
      type: attributes.type,
      field: attributes.field,
      ...(attributes.label !== undefined ? { label: attributes.label } : {}),
      ...(attributes.description !== undefined ? { description: attributes.description } : {}),
    })
    return await this.#write(scope, next, version)
  }

  /** Removes a relation of a collection. */
  async removeRelation(scope: ModelScope, key: string, name: string): Promise<number> {
    const collection = this.#collection(key)
    if (!collection) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" is not declared by the deployment`)
    }
    const { version, model } = await this.#read(scope.workspaceId)
    const overlay = model.collections[key]
    if (!collection.relations[name] && !overlay?.relations?.[name]) {
      throw new ModelError('NOT_FOUND', `the collection "${key}" holds no relation "${name}"`)
    }
    const next = withoutRelation(model, key, name)
    return await this.#write(scope, next, version)
  }

  /** The field of the model, built from its attributes. */
  #fieldOf(type: FieldType, attributes: FieldAttributes): ModelField {
    const field: { -readonly [Key in keyof ModelField]: ModelField[Key] } = {
      type,
      required: attributes.required ?? false,
      nullable: attributes.nullable ?? true,
    }
    if (attributes.label !== undefined) field.label = attributes.label
    if (attributes.description !== undefined) field.description = attributes.description
    if (attributes.default !== undefined) field.default = attributes.default
    if (type === 'enum') {
      if (!attributes.enum || attributes.enum.length === 0) {
        throw new ModelError('INVALID_MODEL', 'an enumeration holds at least one value')
      }
      field.enum = attributes.enum
    }
    if (type === 'string' || type === 'text') {
      if (attributes.minimum !== undefined) {
        throw new ModelError('INVALID_MODEL', 'a text holds no minimum')
      }
      if (attributes.maximum !== undefined) {
        throw new ModelError('INVALID_MODEL', 'a text holds no maximum')
      }
      if (attributes.minLength !== undefined) field.minLength = attributes.minLength
      if (attributes.maxLength !== undefined) field.maxLength = attributes.maxLength
    }
    if (type === 'integer' || type === 'decimal') {
      if (attributes.minLength !== undefined) {
        throw new ModelError('INVALID_MODEL', 'a number holds no minimum length')
      }
      if (attributes.maxLength !== undefined) {
        throw new ModelError('INVALID_MODEL', 'a number holds no maximum length')
      }
      if (attributes.minimum !== undefined) field.minimum = attributes.minimum
      if (attributes.maximum !== undefined) field.maximum = attributes.maximum
    }
    if (
      field.minimum !== undefined &&
      field.maximum !== undefined &&
      field.minimum > field.maximum
    ) {
      throw new ModelError('INVALID_MODEL', 'the minimum of a field is above its maximum')
    }
    return field
  }

  /**
   * Checks that the table of the collection holds the column of a field.
   *
   * The table of the collection is a table of the deployment, and the
   * deployment holds its columns: a field of the model that names no
   * column is refused here and never reaches the database.
   */
  async #checkColumn(
    collection: CollectionDefinition,
    name: string,
    type: FieldType
  ): Promise<void> {
    const columns = await this.#options.columns.columns(collection.table)
    const column = columns.find((entry) => entry.name === name)
    if (!column) {
      throw new ModelError(
        'INVALID_MODEL',
        `the table "${collection.table}" holds no column "${name}": the deployment holds the tables`
      )
    }
    const types = COLUMN_TYPES[column.type.toLowerCase()]
    if (!types) {
      throw new ModelError(
        'INVALID_MODEL',
        `the column "${name}" of the table "${collection.table}" has a type the model does not know`
      )
    }
    if (!types.includes(type)) {
      throw new ModelError(
        'INVALID_MODEL',
        `the column "${name}" of the table "${collection.table}" holds ${column.type} and not ${type}`
      )
    }
  }

  /** Checks that a relation can hold. */
  async #checkRelation(
    scope: ModelScope,
    collection: CollectionDefinition,
    overlay: ModelCollection | undefined,
    name: string,
    attributes: RelationAttributes
  ): Promise<void> {
    const target = this.#collection(attributes.target)
    if (!target) {
      throw new ModelError(
        'INVALID_MODEL',
        `the relation "${name}" points at the collection "${attributes.target}", which the deployment does not declare`
      )
    }
    const served = await this.#options.served.served(scope.workspaceId)
    if (!served.includes(target.key)) {
      throw new ModelError(
        'INVALID_MODEL',
        `the relation "${name}" points at the collection "${target.key}", which the workspace does not serve`
      )
    }
    if (attributes.type !== 'many-to-one' && attributes.type !== 'one-to-many') {
      throw new ModelError('INVALID_MODEL', `the relation "${name}" has an unknown kind`)
    }
    const holder = attributes.type === 'many-to-one' ? collection : target
    const field = this.#fieldOfHolder(holder, overlay, attributes.field)
    if (!field) {
      throw new ModelError(
        'INVALID_MODEL',
        `the relation "${name}" names the field "${attributes.field}", which the collection "${holder.key}" does not hold`
      )
    }
    if (field.type !== 'uuid') {
      throw new ModelError(
        'INVALID_MODEL',
        `the relation "${name}" points at the field "${attributes.field}", which is not an identifier`
      )
    }
  }

  /** The field of a collection, as the model of the workspace holds it. */
  #fieldOfHolder(
    holder: CollectionDefinition,
    overlay: ModelCollection | undefined,
    name: string
  ): FieldDefinition | undefined {
    if (overlay?.removed?.includes(name)) return undefined
    const override = overlay?.fields?.[name]
    const base = holder.fields[name]
    if (override && base) return { ...base, ...override }
    return override ?? base
  }

  /** The relations of a collection that use a field. */
  #relationsUsing(
    collection: CollectionDefinition,
    overlay: ModelCollection | undefined,
    name: string
  ): string[] {
    const used: string[] = []
    for (const [relationName, relation] of Object.entries(collection.relations)) {
      if (relation.field === name) used.push(relationName)
    }
    for (const [relationName, relation] of Object.entries(overlay?.relations ?? {})) {
      if (relation.field === name && !used.includes(relationName)) used.push(relationName)
    }
    return used
  }
}

/** The fields the server maintains, which a model never holds. */
const SERVER_FIELDS = new Set([
  'id',
  'tenant_id',
  'workspace_id',
  'created_by',
  'created_at',
  'updated_by',
  'updated_at',
  'version',
])
