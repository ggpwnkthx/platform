/**
 * The model of a workspace (spec §7.6).
 *
 * The model is the logical shape of the collections of a workspace, and
 * it is applied to the manifest of the deployment when the catalog of the
 * workspace is resolved. These tests hold it to that promise: a change
 * of the model is a change of the schema of the workspace, and a change
 * that cannot hold is refused before it reaches the database.
 */

import { describe, expect, test } from 'bun:test'
import {
  ModelService,
  applyModel,
  emptyModel,
  parseWorkspaceModel,
  schemaVersionOf,
} from '../../src/domains/model'
import {
  withCollection,
  withField,
  withOrder,
  withRelation,
  withoutField,
} from '../../src/domains/model/model'
import { parseManifestBundle } from '../../src/domains/schema'

/** The manifest of the deployment of the tests. */
const manifest = parseManifestBundle(
  JSON.stringify({
    version: 1,
    schemaVersion: '2024.1',
    collections: [
      {
        key: 'articles',
        table: 'data.articles',
        label: 'The articles',
        fields: {
          title: { type: 'string', required: true, nullable: false },
          body: { type: 'text', required: false, nullable: true },
          status: { type: 'enum', required: true, nullable: false, enum: ['draft', 'published'] },
        },
        relations: {},
      },
      {
        key: 'categories',
        table: 'data.categories',
        label: 'The categories',
        fields: {
          name: { type: 'string', required: true, nullable: false },
        },
        relations: {},
      },
    ],
  })
)

/** The scope of the tests. */
const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  principalId: '33333333-3333-4333-8333-333333333333',
}

/** A store of the model that holds it in memory. */
function memoryStore() {
  let version = 0
  let model = emptyModel()
  return {
    read: async () => ({ version, model }),
    write: async (options: { model: typeof model; expectedVersion: number }) => {
      if (options.expectedVersion !== version) throw new Error('the model moved')
      model = options.model
      version += 1
      return version
    },
  }
}

/** A reader of the columns of the tables of the deployment. */
const columns = {
  columns: async (table: string) => {
    if (table === 'data.articles') {
      return [
        { name: 'title', type: 'text' },
        { name: 'body', type: 'text' },
        { name: 'status', type: 'text' },
        { name: 'subtitle', type: 'text' },
        { name: 'category_id', type: 'uuid' },
      ]
    }
    return [{ name: 'name', type: 'text' }]
  },
}

/** A registrar of the collections that holds them in memory. */
const registrar = {
  registered: async () => [] as readonly { key: string; enabled: boolean }[],
  enable: async () => {},
  disable: async () => {},
}

/** A service of the model with a store in memory. */
function service() {
  return new ModelService({
    deployment: manifest,
    store: memoryStore(),
    columns,
    registrar,
    served: { served: async () => ['articles', 'categories'] },
  })
}

describe('the model of a workspace', () => {
  test('a model that changes nothing is the manifest of the deployment', () => {
    const applied = applyModel(manifest, emptyModel())
    expect(applied).toBe(manifest)
    expect(schemaVersionOf(applied, emptyModel())).toBe('2024.1')
  })

  test('the label of a collection is the label of the model', () => {
    const model = withCollection(emptyModel(), 'articles', { label: 'The stories' })
    const applied = applyModel(manifest, model)
    const articles = applied.collections.find((entry) => entry.key === 'articles')
    expect(articles?.label).toBe('The stories')
    expect(schemaVersionOf(applied, model)).not.toBe('2024.1')
  })

  test('a field that the model does not hold is not part of the collection', () => {
    const model = withoutField(emptyModel(), 'articles', 'body')
    const applied = applyModel(manifest, model)
    const articles = applied.collections.find((entry) => entry.key === 'articles')
    expect(Object.keys(articles?.fields ?? {})).toEqual(['title', 'status'])
  })

  test('a field that the model adds is part of the collection', () => {
    const model = withField(emptyModel(), 'articles', 'subtitle', {
      type: 'string',
      required: false,
      nullable: true,
    })
    const applied = applyModel(manifest, model)
    const articles = applied.collections.find((entry) => entry.key === 'articles')
    expect(articles?.fields.subtitle?.type).toBe('string')
  })

  test('a relation of the model points at another collection', () => {
    const model = withRelation(emptyModel(), 'articles', 'category', {
      target: 'categories',
      type: 'many-to-one',
      field: 'category_id',
    })
    const applied = applyModel(manifest, model)
    const articles = applied.collections.find((entry) => entry.key === 'articles')
    expect(articles?.relations.category?.target).toBe('categories')
  })

  test('the order of the model is the order of the fields', () => {
    const model = withOrder(emptyModel(), 'articles', ['status', 'title', 'body'])
    const applied = applyModel(manifest, model)
    const articles = applied.collections.find((entry) => entry.key === 'articles')
    expect(Object.keys(articles?.fields ?? {})).toEqual(['status', 'title', 'body'])
  })

  test('a model that cannot be parsed is refused', () => {
    expect(() => parseWorkspaceModel({ version: 2, collections: {} })).toThrow()
    expect(() =>
      parseWorkspaceModel({
        version: 1,
        collections: { articles: { fields: { a: { type: 'word' } } } },
      })
    ).toThrow()
  })
})

describe('the service of the model', () => {
  test('the label of a collection is written and read again', async () => {
    const model = service()
    await model.setCollection(scope, 'articles', { label: 'The stories' })
    const document = await model.describe(scope.workspaceId, '2024.1', ['articles', 'categories'])
    const articles = document.collections.find((entry) => entry.key === 'articles')
    expect(articles?.label).toBe('The stories')
    expect(document.version).toBe(1)
  })

  test('a field whose column the deployment does not hold is refused', async () => {
    const model = service()
    await expect(model.addField(scope, 'articles', 'unknown', { type: 'string' })).rejects.toThrow(
      /holds no column/
    )
  })

  test('a field whose column holds another type is refused', async () => {
    const model = service()
    await expect(
      model.addField(scope, 'articles', 'category_id', { type: 'string' })
    ).rejects.toThrow(/holds uuid/)
  })

  test('a field the deployment holds is added to the model', async () => {
    const model = service()
    await model.addField(scope, 'articles', 'subtitle', { type: 'string', label: 'The subtitle' })
    const document = await model.describe(scope.workspaceId, '2024.1', ['articles', 'categories'])
    const articles = document.collections.find((entry) => entry.key === 'articles')
    const subtitle = articles?.fields.find((entry) => entry.name === 'subtitle')
    expect(subtitle?.deployment).toBe(false)
    expect(subtitle?.label).toBe('The subtitle')
  })

  test('the type of a field of the deployment never changes', async () => {
    const model = service()
    await expect(model.changeField(scope, 'articles', 'title', { type: 'json' })).rejects.toThrow(
      /never changes/
    )
  })

  test('a relation that points at a field that is not an identifier is refused', async () => {
    const model = service()
    await expect(
      model.addRelation(scope, 'articles', 'category', {
        target: 'categories',
        type: 'many-to-one',
        field: 'title',
      })
    ).rejects.toThrow(/not an identifier/)
  })

  test('a relation that points at a collection the workspace does not serve is refused', async () => {
    const model = new ModelService({
      deployment: manifest,
      store: memoryStore(),
      columns,
      registrar,
      served: { served: async () => ['articles'] },
    })
    await expect(
      model.addRelation(scope, 'articles', 'category', {
        target: 'categories',
        type: 'many-to-one',
        field: 'category_id',
      })
    ).rejects.toThrow(/does not serve/)
  })

  test('a field moves in the order of the model', async () => {
    const model = service()
    await model.moveField(scope, 'articles', 'body', 'up')
    const document = await model.describe(scope.workspaceId, '2024.1', ['articles', 'categories'])
    const articles = document.collections.find((entry) => entry.key === 'articles')
    const names = articles?.fields.map((field) => field.name)
    expect(names?.indexOf('body')).toBeLessThan(names?.indexOf('status') ?? 0)
  })

  test('the model of a workspace is described with the fields it holds', async () => {
    const model = service()
    await model.changeField(scope, 'articles', 'title', { label: 'The title of the article' })
    const document = await model.describe(scope.workspaceId, '2024.1', ['articles', 'categories'])
    const articles = document.collections.find((entry) => entry.key === 'articles')
    const title = articles?.fields.find((entry) => entry.name === 'title')
    expect(title?.label).toBe('The title of the article')
    expect(title?.deployment).toBe(true)
    expect(title?.held).toBe(true)
  })
})
