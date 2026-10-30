import { describe, expect, test } from 'bun:test'
import { overallOf, probeOf, probeService, stateOf, summaryOf, versionOf } from '../src/probes'
import type { ClientAnswer, ClientTransport } from '../src/transport'

/**
 * The probes of the services of the platform.
 *
 * The three services answer the same probes, and they answer them the
 * same way: the same paths, the same fields and the same vocabulary of
 * the readiness.
 */

/** A transport that answers with what it is given. */
function transportOf(answers: Record<string, ClientAnswer>): ClientTransport {
  return {
    send: async (request) => {
      const answer = answers[request.url]
      if (!answer) throw new Error(`the call ${request.url} was not expected`)
      return answer
    },
  }
}

describe('the probes of the services', () => {
  test('a probe that answers is a probe that is up', async () => {
    const transport = transportOf({
      'https://gateway.example.test/healthz': {
        status: 200,
        headers: {},
        body: '{"status":"ok","service":"gateway","version":"1.0.0"}',
      },
    })
    const answer = await probeOf(transport, 'https://gateway.example.test/healthz')
    expect(answer.ok).toBe(true)
    expect(answer.status).toBe(200)
    expect(versionOf(answer)).toBe('1.0.0')
  })

  test('a probe that does not answer is a probe that failed', async () => {
    const transport: ClientTransport = {
      send: async () => {
        throw new Error('the service cannot be reached')
      },
    }
    const answer = await probeOf(transport, 'https://gateway.example.test/healthz')
    expect(answer.ok).toBe(false)
    expect(answer.status).toBeNull()
    expect(answer.error).toBe('the service cannot be reached')
  })

  test('the state of a service is read from its two probes', () => {
    const up = { status: 200, ok: true, latencyMs: 1, body: null, error: null }
    const refused = { status: 503, ok: false, latencyMs: 1, body: null, error: null }
    const down = { status: null, ok: false, latencyMs: 1, body: null, error: 'gone' }
    expect(stateOf(up, up)).toBe('up')
    expect(stateOf(up, refused)).toBe('degraded')
    expect(stateOf(down, down)).toBe('down')
  })

  test('a service without an url is unconfigured', async () => {
    const transport: ClientTransport = {
      send: async () => {
        throw new Error('the call was not expected')
      },
    }
    const status = await probeService(transport, {
      id: 'data',
      name: 'Data',
      url: null,
    })
    expect(status.state).toBe('unconfigured')
  })

  test('the state of the platform is the worst state of its services', () => {
    const service = (state: 'up' | 'degraded' | 'down' | 'unconfigured') => ({
      id: 'x',
      name: 'X',
      state,
      version: null,
      health: null,
      ready: null,
      checkedAt: '',
    })
    expect(overallOf([service('up'), service('degraded')])).toBe('degraded')
    expect(overallOf([service('up'), service('down')])).toBe('down')
    expect(overallOf([service('unconfigured')])).toBe('unconfigured')
  })

  test('the summary of a status holds the states and nothing else', () => {
    const status = {
      id: 'x',
      name: 'X',
      state: 'up' as const,
      version: '1.0.0',
      health: { status: 200, ok: true, latencyMs: 1, body: null, error: null },
      ready: null,
      checkedAt: '',
    }
    const summary = summaryOf(status)
    expect(summary.version).toBeNull()
    expect(summary.health).toBeNull()
  })
})
