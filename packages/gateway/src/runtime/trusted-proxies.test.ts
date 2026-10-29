import { describe, expect, test } from 'bun:test'
import { trustedProxyProblems } from './trusted-proxies'

/**
 * The problems of the ranges of the trusted proxies.
 *
 * The rule is the rule of the trust of a deployment: a peer that is inside
 * a trusted range chooses the host of the request, the address of the
 * caller and the protocol of the request, so the trust of a range is the
 * trust of every workload of that range.
 */
describe('the problems of the ranges of the trusted proxies', () => {
  test('the ranges of the proxies of a deployment have no problem', () => {
    expect(trustedProxyProblems([])).toEqual([])
    expect(trustedProxyProblems(['127.0.0.1/32', '::1/128'])).toEqual([])
    expect(trustedProxyProblems(['10.0.0.0/28'])).toEqual([])
  })

  test('a range that covers a network is named', () => {
    const problems = trustedProxyProblems(['127.0.0.1/32', '10.0.0.0/8'])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('10.0.0.0/8')
    expect(problems[0]).toContain('too wide')
  })

  test('a value that cannot be read is named apart from a wide range', () => {
    const problems = trustedProxyProblems(['not-a-range', '10.0.0.0/8'])
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('not ranges')
    expect(problems[1]).toContain('too wide')
  })
})
