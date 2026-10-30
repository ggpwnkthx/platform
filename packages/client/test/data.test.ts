import { describe, expect, test } from 'bun:test'
import { DataClient } from '../src/data'
import type { ClientAnswer, ClientRequest, ClientTransport } from '../src/transport'

/**
 * The client of the data of a workspace.
 *
 * The client speaks to the gateway: it builds the paths of the
 * contract, it carries the credential of the caller and the validator of
 * a record, and it raises the refusal of the service.
 */
interface Call {
  readonly request: ClientRequest
}

/** A transport that records the calls it is given and answers them. */
function transportOf(answers: Record<string, ClientAnswer>): {
  transport: ClientTransport
  calls: Call[]
} {
  const calls: Call[] = []
  const transport: ClientTransport = {
    send: async (request) => {
      calls.push({ request })
      const answer = answers[`${request.method} ${request.url}`]
      if (!answer) throw new Error(`the call ${request.method} ${request.url} was not expected`)
      return answer
    },
  }
  return { transport, calls }
}

const OPTIONS = {
  baseUrl: 'https://gateway.example.test',
  workspaceId: 'workspace-1',
  token: 'the-token',
}

/** The answer of a successful call. */
function ok(body: string, headers: Record<string, string> = {}): ClientAnswer {
  return { status: 200, headers, body }
}

describe('the client of the data', () => {
  test('the path of a call carries the workspace', async () => {
    const { transport, calls } = transportOf({
      'GET https://gateway.example.test/ws/workspace-1/v1/me': ok('{"data":{"id":"x"}}'),
    })
    const client = new DataClient({ ...OPTIONS, transport })
    await client.me()
    expect(calls[0]?.request.url).toBe('https://gateway.example.test/ws/workspace-1/v1/me')
  })

  test('the credential of the caller travels in the headers', async () => {
    const { transport, calls } = transportOf({
      'GET https://gateway.example.test/ws/workspace-1/v1/me': ok('{}'),
    })
    const client = new DataClient({ ...OPTIONS, transport })
    await client.me()
    expect(calls[0]?.request.headers?.authorization).toBe('Bearer the-token')
  })

  test('the query of a page is written as the contract names it', async () => {
    const { transport, calls } = transportOf({
      'GET https://gateway.example.test/ws/workspace-1/v1/items/notes?fields=a&filter=%7B%7D&include_count=true&limit=10':
        ok('{}'),
    })
    const client = new DataClient({ ...OPTIONS, transport })
    await client.list('notes', { fields: ['a'], filter: {}, includeCount: true, limit: 10 })
    expect(calls[0]?.request.url).toContain('include_count=true')
    expect(calls[0]?.request.url).toContain('limit=10')
  })

  test('the parameters the contract names are passed through', async () => {
    const { transport, calls } = transportOf({
      'GET https://gateway.example.test/ws/workspace-1/v1/items/notes?include_count=true': ok('{}'),
    })
    const client = new DataClient({ ...OPTIONS, transport })
    await client.list('notes', { include_count: 'true' })
    expect(calls[0]?.request.url).toContain('include_count=true')
  })

  test('the validator of a record is read from the answer', async () => {
    const { transport } = transportOf({
      'GET https://gateway.example.test/ws/workspace-1/v1/items/notes/1': ok('{"data":{}}', {
        etag: 'the-etag',
      }),
    })
    const client = new DataClient({ ...OPTIONS, transport })
    const record = await client.get('notes', '1')
    expect(record.etag).toBe('the-etag')
  })

  test('the update of a record carries the validator of the caller', async () => {
    const { transport, calls } = transportOf({
      'PATCH https://gateway.example.test/ws/workspace-1/v1/items/notes/1': ok('{"data":{}}', {
        etag: 'the-etag',
      }),
    })
    const client = new DataClient({ ...OPTIONS, transport })
    const record = await client.update('notes', '1', { title: 'a' }, 'the-etag')
    expect(calls[0]?.request.headers?.['if-match']).toBe('the-etag')
    expect(record.etag).toBe('the-etag')
  })

  test('the creation of a record carries the key of the idempotency', async () => {
    const { transport, calls } = transportOf({
      'POST https://gateway.example.test/ws/workspace-1/v1/items/notes': ok('{"data":{}}', {
        'idempotency-replayed': 'true',
      }),
    })
    const client = new DataClient({ ...OPTIONS, transport })
    const created = await client.create('notes', { title: 'a' }, 'the-key')
    expect(calls[0]?.request.headers?.['idempotency-key']).toBe('the-key')
    expect(created.replayed).toBe(true)
  })

  test('the model of the workspace is read', async () => {
    const { transport, calls } = transportOf({
      'GET https://gateway.example.test/ws/workspace-1/v1/model': ok('{"data":{}}'),
    })
    const client = new DataClient({ ...OPTIONS, transport })
    await client.model()
    expect(calls[0]?.request.method).toBe('GET')
  })

  test('the refusal of the service is raised', async () => {
    const { transport } = transportOf({
      'GET https://gateway.example.test/ws/workspace-1/v1/me': {
        status: 403,
        headers: {},
        body: '{"error":{"code":"FORBIDDEN","message":"no"}}',
      },
    })
    const client = new DataClient({ ...OPTIONS, transport })
    await expect(client.me()).rejects.toThrow('no')
  })

  test('the collection of a model is registered with its key', async () => {
    const { transport, calls } = transportOf({
      'POST https://gateway.example.test/ws/workspace-1/v1/model/collections': ok('{}'),
    })
    const client = new DataClient({ ...OPTIONS, transport })
    await client.registerCollection('notes')
    expect(calls[0]?.request.body).toBe('{"key":"notes"}')
  })
})
