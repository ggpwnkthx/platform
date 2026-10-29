import { describe, expect, test } from 'bun:test'
import { expectSuccess, refusalOf, requestIdOf } from '../src/domains/answer'
import { CliFailure, exitCodeOf } from '../src/domains/failure'

describe('the refusals of the services', () => {
  test('the refusal of the gateway and of Access carries its code', () => {
    const refusal = refusalOf({
      status: 403,
      headers: {},
      body: JSON.stringify({ error: 'workspace_forbidden', message: 'not for this one' }),
    })
    expect(refusal.code).toBe('workspace_forbidden')
    expect(refusal.message).toBe('not for this one')
  })

  test('the refusal of the data API carries its code', () => {
    const refusal = refusalOf({
      status: 409,
      headers: {},
      body: JSON.stringify({
        error: { code: 'CONFLICT', message: 'the record changed' },
        requestId: 'r-1',
      }),
    })
    expect(refusal.code).toBe('CONFLICT')
    expect(refusal.message).toBe('the record changed')
  })

  test('a refusal that carries nothing is named by its status', () => {
    const refusal = refusalOf({ status: 502, headers: {}, body: 'bad gateway' })
    expect(refusal.code).toBe('http_502')
    expect(refusal.message).toBe('bad gateway')
  })

  test('the request id is read from the header or from the body', () => {
    expect(requestIdOf({ status: 200, headers: { 'x-request-id': 'r-1' }, body: '{}' })).toBe('r-1')
    expect(
      requestIdOf({
        status: 200,
        headers: {},
        body: JSON.stringify({ requestId: 'r-2' }),
      })
    ).toBe('r-2')
  })
})

describe('the status of the process', () => {
  test('the code of the service decides the status', () => {
    expect(exitCodeOf(401, 'unauthorized')).toBe(3)
    expect(exitCodeOf(403, 'FORBIDDEN')).toBe(6)
    expect(exitCodeOf(404, 'NOT_FOUND')).toBe(4)
    expect(exitCodeOf(409, 'CONFLICT')).toBe(5)
    expect(exitCodeOf(422, 'VALIDATION_FAILED')).toBe(8)
    expect(exitCodeOf(503, 'DATABASE_UNAVAILABLE')).toBe(7)
  })

  test('the status of the answer decides when the code is unknown', () => {
    expect(exitCodeOf(401)).toBe(3)
    expect(exitCodeOf(404)).toBe(4)
    expect(exitCodeOf(429)).toBe(1)
    expect(exitCodeOf(500)).toBe(1)
  })

  test('a refusal of a service ends the process with its status', () => {
    try {
      expectSuccess(
        { status: 403, headers: {}, body: JSON.stringify({ error: 'forbidden' }) },
        'GET /v1/config'
      )
      throw new Error('the refusal was accepted')
    } catch (error) {
      expect(error).toBeInstanceOf(CliFailure)
      expect((error as CliFailure).exit).toBe(6)
    }
  })

  test('a success is the body of the answer', () => {
    expect(
      expectSuccess({ status: 200, headers: {}, body: '{"revision":4}' }, 'GET /v1/config')
    ).toEqual({ revision: 4 })
  })
})
