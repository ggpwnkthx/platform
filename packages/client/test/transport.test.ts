import { describe, expect, test } from 'bun:test'
import {
  bodyOf,
  ClientError,
  expectSuccess,
  isSuccess,
  queryOf,
  refusalOf,
  requestIdOf,
  type ClientAnswer,
  type ClientRequest,
  type ClientTransport,
} from '../src/transport'

/**
 * The transport of the clients of the platform.
 *
 * The transport is a port: it is a promise of a shape, and every
 * implementation of it is free to be another one. The refusal of a
 * service is read here, once: the gateway and Access answer
 * `{"error":"<code>","message":"<text>"}` and the data API answers
 * `{"error":{"code":"<CODE>","message":"<text>"},"requestId":"<id>"}`.
 */
function answerOf(
  status: number,
  body: string,
  headers: Record<string, string> = {}
): ClientAnswer {
  return { status, headers, body }
}

/** A transport that answers with what it is given. */
function transportOf(answer: ClientAnswer): ClientTransport {
  return { send: async (_request: ClientRequest) => answer }
}

describe('the transport of the clients', () => {
  test('the body of an answer is json, or the text it was', () => {
    expect(bodyOf(answerOf(200, '{"a":1}'))).toEqual({ a: 1 })
    expect(bodyOf(answerOf(200, 'plain'))).toBe('plain')
    expect(bodyOf(answerOf(204, ''))).toBeNull()
  })

  test('the refusal of the gateway is read', () => {
    const refusal = refusalOf(answerOf(401, '{"error":"unauthorized","message":"no"}'))
    expect(refusal.code).toBe('unauthorized')
    expect(refusal.message).toBe('no')
  })

  test('the refusal of the data API is read', () => {
    const refusal = refusalOf(
      answerOf(409, '{"error":{"code":"CONFLICT","message":"taken","details":[{"field":"id"}]}}')
    )
    expect(refusal.code).toBe('CONFLICT')
    expect(refusal.message).toBe('taken')
    expect(refusal.details).toEqual([{ field: 'id' }])
  })

  test('a refusal that carries nothing readable is named by its status', () => {
    const refusal = refusalOf(answerOf(500, 'boom'))
    expect(refusal.code).toBe('http_500')
    expect(refusal.message).toBe('boom')
  })

  test('the request id is read in the header and in the body', () => {
    expect(requestIdOf(answerOf(200, '{}', { 'x-request-id': 'abc' }))).toBe('abc')
    expect(requestIdOf(answerOf(200, '{"requestId":"def"}'))).toBe('def')
    expect(requestIdOf(answerOf(200, '{}'))).toBeUndefined()
  })

  test('a success is a status of the range', () => {
    expect(isSuccess(answerOf(200, ''))).toBe(true)
    expect(isSuccess(answerOf(302, ''))).toBe(false)
  })

  test('a refusal is raised with the code of the service', () => {
    expect(() => expectSuccess(answerOf(404, '{"error":"not_found"}'), 'GET /me')).toThrow(
      ClientError
    )
    try {
      expectSuccess(answerOf(404, '{"error":"not_found","message":"gone"}'), 'GET /me')
    } catch (error) {
      expect(error).toBeInstanceOf(ClientError)
      const failure = error as ClientError
      expect(failure.code).toBe('not_found')
      expect(failure.status).toBe(404)
      expect(failure.message).toBe('GET /me: gone')
    }
  })

  test('the query of a call is written as an url', () => {
    expect(queryOf({ limit: 10, cursor: 'abc' })).toBe('limit=10&cursor=abc')
    expect(queryOf({ sort: ['a', 'b'] })).toBe('sort=a%2Cb')
    expect(queryOf({ filter: { eq: 1 } })).toBe('filter=%7B%22eq%22%3A1%7D')
    expect(queryOf({ limit: undefined, cursor: null })).toBe('')
    expect(queryOf({ include: [] })).toBe('')
  })

  test('a transport answers with what it is given', async () => {
    const transport = transportOf(answerOf(200, '{"ok":true}'))
    const answer = await transport.send({ method: 'GET', url: 'https://example.test' })
    expect(answer.body).toBe('{"ok":true}')
  })
})
