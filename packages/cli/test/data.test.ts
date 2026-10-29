import { describe, expect, test } from 'bun:test'
import {
  aggregate,
  createItem,
  getItem,
  listItems,
  me,
  moveField,
  removeItem,
  rollback,
  schema,
  updateItem,
} from '../src/domains/data'
import { FakeHttp } from './support'

/**
 * The parameters of a call to the data API.
 *
 * @param http the transport of the call.
 */
function callOf(http: FakeHttp) {
  return {
    http,
    baseUrl: 'https://api.example.com',
    token: 'the-caller-token',
    workspaceId: '11111111-1111-4111-8111-111111111111',
  }
}

describe('the data of a workspace', () => {
  test('the identity of the caller is read from the workspace', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { id: '00u1' }))
    await me(callOf(http))
    expect(http.last.url).toBe(
      'https://api.example.com/ws/11111111-1111-4111-8111-111111111111/v1/me'
    )
  })

  test('the metadata of the collections is read from the workspace', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { collections: [] }))
    await schema(callOf(http))
    expect(http.last.url).toBe(
      'https://api.example.com/ws/11111111-1111-4111-8111-111111111111/v1/schema'
    )
  })

  test('a page of records carries its query', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { data: [], meta: {} }))
    await listItems(callOf(http), 'notes', { limit: 10, sort: '-created_at' })
    expect(http.last.url).toBe(
      'https://api.example.com/ws/11111111-1111-4111-8111-111111111111/v1/items/notes?limit=10&sort=-created_at'
    )
  })

  test('one record is read by its id', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { data: { id: 'r1' } }))
    await getItem(callOf(http), 'notes', 'r1')
    expect(http.last.url).toBe(
      'https://api.example.com/ws/11111111-1111-4111-8111-111111111111/v1/items/notes/r1'
    )
  })

  test('a record is created with its body', async () => {
    const http = new FakeHttp(FakeHttp.json(201, { data: { id: 'r1' } }))
    await createItem(callOf(http), 'notes', { title: 'Launch notes' })
    expect(http.last.method).toBe('POST')
    expect(http.last.body).toBe(JSON.stringify({ title: 'Launch notes' }))
  })

  test('a creation may carry the key that makes it repeatable', async () => {
    const http = new FakeHttp(FakeHttp.json(201, { data: { id: 'r1' } }))
    await createItem(callOf(http), 'notes', { title: 'x' }, 'the-key')
    expect(http.last.headers?.['idempotency-key']).toBe('the-key')
  })

  test('a change carries the validator of the record', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { data: { id: 'r1' } }))
    await updateItem(callOf(http), 'notes', 'r1', { title: 'new' }, 'the-etag')
    expect(http.last.method).toBe('PATCH')
    expect(http.last.headers?.['if-match']).toBe('the-etag')
  })

  test('a record is removed with its validator', async () => {
    const http = new FakeHttp(FakeHttp.json(204, null))
    await removeItem(callOf(http), 'notes', 'r1', 'the-etag')
    expect(http.last.method).toBe('DELETE')
    expect(http.last.headers?.['if-match']).toBe('the-etag')
  })

  test('a record is rolled back to a version', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { data: { id: 'r1' } }))
    await rollback(callOf(http), 'notes', 'r1', 3)
    expect(http.last.method).toBe('POST')
    expect(http.last.body).toBe(JSON.stringify({ version: 3 }))
  })

  test('the aggregate carries its groups and its metrics', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { data: [] }))
    await aggregate(callOf(http), 'notes', { group_by: 'status', metrics: 'sum:amount' })
    expect(http.last.url).toBe(
      'https://api.example.com/ws/11111111-1111-4111-8111-111111111111/v1/aggregate/notes?group_by=status&metrics=sum%3Aamount'
    )
  })

  test('a field of the model moves up or down', async () => {
    const http = new FakeHttp(FakeHttp.json(200, { data: {} }))
    await moveField(callOf(http), 'notes', 'title', 'down')
    expect(http.last.method).toBe('POST')
    expect(http.last.body).toBe(JSON.stringify({ direction: 'down' }))
  })
})
