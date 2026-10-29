/**
 * The data of a workspace.
 *
 * Every command of the data goes through the gateway: the CLI is an API
 * client, it authenticates like any other, and it never reaches a
 * database. The workspace is part of every path, and the CLI never
 * guesses it.
 */

import type { GroupSpec } from '../../app/commands'
import { bodyOf, listOf, numberOf, stringOf } from '../../app/commands'
import { CliFailure } from '../../domains/failure'
import {
  addField,
  addRelation,
  aggregate,
  audit,
  collection,
  createItem,
  getItem,
  listItems,
  me,
  model,
  moveField,
  registerCollection,
  removeCollection,
  removeItem,
  removeField,
  removeRelation,
  rollback,
  schema,
  updateCollection,
  updateField,
  updateItem,
  updateRelation,
  version,
  versions,
} from '../../domains/data'
import { confirm } from '../../app/prompt'
import { dataCall } from './calls'

/** The options of the commands that write a body. */
const BODY_OPTIONS = [
  { name: 'body', kind: 'string' as const, summary: 'the file of the body of the write' },
  { name: 'data', kind: 'string' as const, summary: 'the body of the write, as json' },
]

/**
 * The records of an answer of the data API.
 *
 * @param body the answer of the data API.
 */
function recordsOf(body: unknown): readonly Record<string, unknown>[] {
  if (typeof body !== 'object' || body === null) return []
  const data = (body as Record<string, unknown>).data
  if (!Array.isArray(data)) return []
  return data.filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null
  )
}

/**
 * The lines of an answer that holds one thing.
 *
 * The envelope of the data API wraps every answer in a `data` field,
 * and a reader wants the thing and not the wrapper.
 *
 * @param body the answer of the data API.
 */
function linesOfOne(body: unknown): string[] {
  const record =
    typeof body === 'object' && body !== null && 'data' in body
      ? (body as Record<string, unknown>).data
      : body
  if (typeof record !== 'object' || record === null) return [String(record)]
  return Object.entries(record as Record<string, unknown>).map(
    ([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
  )
}

/**
 * The lines of a list of records.
 *
 * @param records the records of the answer.
 */
function linesOf(records: readonly Record<string, unknown>[]): string[] {
  if (records.length === 0) return ['there is nothing']
  const columns: string[] = []
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }
  const widths = columns.map((column) =>
    Math.max(column.length, ...records.map((record) => String(record[column] ?? '').length))
  )
  return [
    columns
      .map((column, index) => column.padEnd(widths[index]!))
      .join('  ')
      .trimEnd(),
    ...records.map((record) =>
      columns
        .map((column, index) => String(record[column] ?? '').padEnd(widths[index]!))
        .join('  ')
        .trimEnd()
    ),
  ]
}

/** The group of the data. */
export const dataGroup: GroupSpec = {
  name: 'data',
  summary: 'the records, the model and the audit of a workspace',
  description:
    'The data API is behind the gateway, and it needs the signed identity of the gateway: the CLI signs in like any other client.',
  commands: [
    {
      name: 'me',
      summary: 'show the identity of the caller in the workspace',
      async run(input) {
        const body = await me(await dataCall(input))
        return { value: body, lines: linesOfOne(body) }
      },
    },
    {
      name: 'schema',
      summary: 'show the metadata of the collections of the workspace',
      arguments: [{ name: 'collection', summary: 'the key of one collection', required: false }],
      async run(input) {
        const call = await dataCall(input)
        const key = input.args[0]
        if (key) {
          const body = await collection(call, key)
          return { value: body, lines: linesOfOne(body) }
        }
        const body = await schema(call)
        return { value: body, lines: linesOfOne(body) }
      },
    },
    {
      name: 'items list',
      summary: 'list a page of the records of a collection',
      arguments: [{ name: 'collection', summary: 'the key of the collection', required: true }],
      options: [
        { name: 'fields', kind: 'list', summary: 'a field of the projection' },
        { name: 'filter', kind: 'string', summary: 'the filter of the page, as json' },
        { name: 'search', kind: 'string', summary: 'the text the records hold' },
        { name: 'sort', kind: 'list', summary: 'a field of the order' },
        { name: 'limit', kind: 'string', summary: 'the size of the page' },
        { name: 'cursor', kind: 'string', summary: 'the cursor of the page' },
        { name: 'include', kind: 'list', summary: 'a relation to expand' },
        { name: 'include-count', kind: 'boolean', summary: 'return the number of the records' },
      ],
      examples: ['platformctl data items list notes --limit 10 --sort "-created_at"'],
      async run(input) {
        const key = input.args[0]
        if (!key) {
          throw new CliFailure('the key of the collection is needed', 2, 'missing_argument')
        }
        const filter = stringOf(input.options, 'filter')
        if (filter) {
          try {
            JSON.parse(filter)
          } catch {
            throw new CliFailure('the filter is not valid json', 8, 'invalid_filter')
          }
        }
        const body = await listItems(await dataCall(input), key, {
          fields: listOf(input.options, 'fields').join(',') || undefined,
          filter,
          search: stringOf(input.options, 'search'),
          sort: listOf(input.options, 'sort').join(',') || undefined,
          limit: numberOf(input.options, 'limit'),
          cursor: stringOf(input.options, 'cursor'),
          include: listOf(input.options, 'include').join(',') || undefined,
          include_count: input.options['include-count'] === true ? 'true' : undefined,
        })
        return { value: body, lines: linesOf(recordsOf(body)) }
      },
    },
    {
      name: 'items get',
      summary: 'read one record',
      arguments: [
        { name: 'collection', summary: 'the key of the collection', required: true },
        { name: 'id', summary: 'the id of the record', required: true },
      ],
      async run(input) {
        const key = input.args[0]
        const id = input.args[1]
        if (!key || !id) {
          throw new CliFailure('the collection and the record are needed', 2, 'missing_argument')
        }
        return { value: await getItem(await dataCall(input), key, id) }
      },
    },
    {
      name: 'items create',
      summary: 'create a record',
      arguments: [{ name: 'collection', summary: 'the key of the collection', required: true }],
      options: [
        ...BODY_OPTIONS,
        {
          name: 'idempotency-key',
          kind: 'string',
          summary: 'the key that makes the creation repeatable',
        },
      ],
      async run(input) {
        const key = input.args[0]
        if (!key) {
          throw new CliFailure('the key of the collection is needed', 2, 'missing_argument')
        }
        const record = await bodyOf(input)
        const written = await createItem(
          await dataCall(input),
          key,
          record,
          stringOf(input.options, 'idempotency-key')
        )
        return { value: written, message: 'the record is created' }
      },
    },
    {
      name: 'items update',
      summary: 'change a record',
      arguments: [
        { name: 'collection', summary: 'the key of the collection', required: true },
        { name: 'id', summary: 'the id of the record', required: true },
      ],
      options: [
        ...BODY_OPTIONS,
        { name: 'etag', kind: 'string', summary: 'the validator of the record' },
      ],
      async run(input) {
        const key = input.args[0]
        const id = input.args[1]
        if (!key || !id) {
          throw new CliFailure('the collection and the record are needed', 2, 'missing_argument')
        }
        const change = await bodyOf(input)
        const written = await updateItem(
          await dataCall(input),
          key,
          id,
          change,
          stringOf(input.options, 'etag')
        )
        return { value: written, message: 'the record is changed' }
      },
    },
    {
      name: 'items delete',
      summary: 'remove a record',
      arguments: [
        { name: 'collection', summary: 'the key of the collection', required: true },
        { name: 'id', summary: 'the id of the record', required: true },
      ],
      options: [{ name: 'etag', kind: 'string', summary: 'the validator of the record' }],
      async run(input) {
        const key = input.args[0]
        const id = input.args[1]
        if (!key || !id) {
          throw new CliFailure('the collection and the record are needed', 2, 'missing_argument')
        }
        await confirm(`the record "${id}" of "${key}" is removed?`, input.globals.yes)
        const removed = await removeItem(
          await dataCall(input),
          key,
          id,
          stringOf(input.options, 'etag')
        )
        return { value: removed ?? { id, removed: true }, message: 'the record is removed' }
      },
    },
    {
      name: 'items versions',
      summary: 'show the history of a record',
      arguments: [
        { name: 'collection', summary: 'the key of the collection', required: true },
        { name: 'id', summary: 'the id of the record', required: true },
      ],
      async run(input) {
        const key = input.args[0]
        const id = input.args[1]
        if (!key || !id) {
          throw new CliFailure('the collection and the record are needed', 2, 'missing_argument')
        }
        return { value: await versions(await dataCall(input), key, id) }
      },
    },
    {
      name: 'items version',
      summary: 'show one version of a record',
      arguments: [
        { name: 'collection', summary: 'the key of the collection', required: true },
        { name: 'id', summary: 'the id of the record', required: true },
        { name: 'version', summary: 'the number of the version', required: true },
      ],
      async run(input) {
        const key = input.args[0]
        const id = input.args[1]
        const number = Number(input.args[2])
        if (!key || !id || !Number.isFinite(number)) {
          throw new CliFailure(
            'the collection, the record and the version are needed',
            2,
            'missing_argument'
          )
        }
        return { value: await version(await dataCall(input), key, id, number) }
      },
    },
    {
      name: 'items rollback',
      summary: 'roll a record back to one of its versions',
      arguments: [
        { name: 'collection', summary: 'the key of the collection', required: true },
        { name: 'id', summary: 'the id of the record', required: true },
        { name: 'version', summary: 'the number of the version', required: true },
      ],
      options: [{ name: 'etag', kind: 'string', summary: 'the validator of the record' }],
      async run(input) {
        const key = input.args[0]
        const id = input.args[1]
        const number = Number(input.args[2])
        if (!key || !id || !Number.isFinite(number)) {
          throw new CliFailure(
            'the collection, the record and the version are needed',
            2,
            'missing_argument'
          )
        }
        await confirm(
          `the record "${id}" of "${key}" is rolled back to the version ${number}?`,
          input.globals.yes
        )
        const written = await rollback(
          await dataCall(input),
          key,
          id,
          number,
          stringOf(input.options, 'etag')
        )
        return { value: written, message: `the record is rolled back to the version ${number}` }
      },
    },
    {
      name: 'aggregate',
      summary: 'aggregate the records of a collection',
      arguments: [{ name: 'collection', summary: 'the key of the collection', required: true }],
      options: [
        { name: 'group-by', kind: 'list', summary: 'a field of the groups' },
        { name: 'metrics', kind: 'list', summary: 'a metric of the groups' },
        { name: 'filter', kind: 'string', summary: 'the filter of the groups, as json' },
        { name: 'limit', kind: 'string', summary: 'the number of the groups' },
      ],
      async run(input) {
        const key = input.args[0]
        if (!key) {
          throw new CliFailure('the key of the collection is needed', 2, 'missing_argument')
        }
        const body = await aggregate(await dataCall(input), key, {
          group_by: listOf(input.options, 'group-by').join(',') || undefined,
          metrics: listOf(input.options, 'metrics').join(',') || undefined,
          filter: stringOf(input.options, 'filter'),
          limit: numberOf(input.options, 'limit'),
        })
        return { value: body, lines: linesOf(recordsOf(body)) }
      },
    },
    {
      name: 'audit',
      summary: 'show the audit of the workspace',
      options: [
        { name: 'limit', kind: 'string', summary: 'the size of the page', default: '50' },
        { name: 'offset', kind: 'string', summary: 'the offset of the page', default: '0' },
      ],
      async run(input) {
        return {
          value: await audit(await dataCall(input), {
            limit: numberOf(input.options, 'limit'),
            offset: numberOf(input.options, 'offset'),
          }),
        }
      },
    },
    {
      name: 'model show',
      summary: 'show the model of the workspace',
      async run(input) {
        const body = await model(await dataCall(input))
        return { value: body, lines: linesOfOne(body) }
      },
    },
    {
      name: 'model collection add',
      summary: 'register a collection of the workspace',
      options: BODY_OPTIONS,
      async run(input) {
        const collection = await bodyOf(input)
        return { value: await registerCollection(await dataCall(input), collection) }
      },
    },
    {
      name: 'model collection update',
      summary: 'change a collection of the model',
      arguments: [{ name: 'collection', summary: 'the key of the collection', required: true }],
      options: BODY_OPTIONS,
      async run(input) {
        const key = input.args[0]
        if (!key) {
          throw new CliFailure('the key of the collection is needed', 2, 'missing_argument')
        }
        const change = await bodyOf(input)
        return { value: await updateCollection(await dataCall(input), key, change) }
      },
    },
    {
      name: 'model collection remove',
      summary: 'remove a collection from the model',
      arguments: [{ name: 'collection', summary: 'the key of the collection', required: true }],
      async run(input) {
        const key = input.args[0]
        if (!key) {
          throw new CliFailure('the key of the collection is needed', 2, 'missing_argument')
        }
        await confirm(`the collection "${key}" is removed from the model?`, input.globals.yes)
        return { value: await removeCollection(await dataCall(input), key) }
      },
    },
    {
      name: 'model field add',
      summary: 'add a field to a collection of the model',
      arguments: [{ name: 'collection', summary: 'the key of the collection', required: true }],
      options: BODY_OPTIONS,
      async run(input) {
        const key = input.args[0]
        if (!key) {
          throw new CliFailure('the key of the collection is needed', 2, 'missing_argument')
        }
        const field = await bodyOf(input)
        return { value: await addField(await dataCall(input), key, field) }
      },
    },
    {
      name: 'model field update',
      summary: 'change a field of the model',
      arguments: [
        { name: 'collection', summary: 'the key of the collection', required: true },
        { name: 'field', summary: 'the key of the field', required: true },
      ],
      options: BODY_OPTIONS,
      async run(input) {
        const key = input.args[0]
        const field = input.args[1]
        if (!key || !field) {
          throw new CliFailure('the collection and the field are needed', 2, 'missing_argument')
        }
        const change = await bodyOf(input)
        return { value: await updateField(await dataCall(input), key, field, change) }
      },
    },
    {
      name: 'model field remove',
      summary: 'remove a field from the model',
      arguments: [
        { name: 'collection', summary: 'the key of the collection', required: true },
        { name: 'field', summary: 'the key of the field', required: true },
      ],
      async run(input) {
        const key = input.args[0]
        const field = input.args[1]
        if (!key || !field) {
          throw new CliFailure('the collection and the field are needed', 2, 'missing_argument')
        }
        await confirm(`the field "${field}" of "${key}" is removed?`, input.globals.yes)
        return { value: await removeField(await dataCall(input), key, field) }
      },
    },
    {
      name: 'model field move',
      summary: 'move a field in the order of its collection',
      arguments: [
        { name: 'collection', summary: 'the key of the collection', required: true },
        { name: 'field', summary: 'the key of the field', required: true },
      ],
      options: [
        {
          name: 'direction',
          kind: 'string',
          summary: 'the direction of the move',
          placeholder: 'up|down',
          default: 'up',
        },
      ],
      async run(input) {
        const key = input.args[0]
        const field = input.args[1]
        const direction = stringOf(input.options, 'direction') ?? 'up'
        if (!key || !field) {
          throw new CliFailure('the collection and the field are needed', 2, 'missing_argument')
        }
        if (direction !== 'up' && direction !== 'down') {
          throw new CliFailure('the direction of the move is up or down', 2, 'invalid')
        }
        return { value: await moveField(await dataCall(input), key, field, direction) }
      },
    },
    {
      name: 'model relation add',
      summary: 'add a relation to the model',
      arguments: [{ name: 'collection', summary: 'the key of the collection', required: true }],
      options: BODY_OPTIONS,
      async run(input) {
        const key = input.args[0]
        if (!key) {
          throw new CliFailure('the key of the collection is needed', 2, 'missing_argument')
        }
        const relation = await bodyOf(input)
        return { value: await addRelation(await dataCall(input), key, relation) }
      },
    },
    {
      name: 'model relation update',
      summary: 'change a relation of the model',
      arguments: [
        { name: 'collection', summary: 'the key of the collection', required: true },
        { name: 'relation', summary: 'the key of the relation', required: true },
      ],
      options: BODY_OPTIONS,
      async run(input) {
        const key = input.args[0]
        const relation = input.args[1]
        if (!key || !relation) {
          throw new CliFailure('the collection and the relation are needed', 2, 'missing_argument')
        }
        const change = await bodyOf(input)
        return { value: await updateRelation(await dataCall(input), key, relation, change) }
      },
    },
    {
      name: 'model relation remove',
      summary: 'remove a relation from the model',
      arguments: [
        { name: 'collection', summary: 'the key of the collection', required: true },
        { name: 'relation', summary: 'the key of the relation', required: true },
      ],
      async run(input) {
        const key = input.args[0]
        const relation = input.args[1]
        if (!key || !relation) {
          throw new CliFailure('the collection and the relation are needed', 2, 'missing_argument')
        }
        await confirm(`the relation "${relation}" of "${key}" is removed?`, input.globals.yes)
        return { value: await removeRelation(await dataCall(input), key, relation) }
      },
    },
  ],
}
