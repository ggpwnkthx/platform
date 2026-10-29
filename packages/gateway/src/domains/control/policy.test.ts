import { describe, expect, test } from 'bun:test'
import { isPublishedControlToken, parseControlTokens } from './policy'

/** The token of an operator of a deployment. */
const TOKEN = 'the-token-of-the-operator-0001'

describe('the map of the tokens of the control plane', () => {
  test('a map that cannot be read stops the control plane', () => {
    expect(() => parseControlTokens('not json')).toThrow(/not valid json/)
    expect(() => parseControlTokens('[]')).toThrow(/not an object of tokens/)
    expect(() => parseControlTokens('{}')).toThrow(/no token/)
  })

  test('a token that is short, without an operator or without a scope is refused', () => {
    expect(() =>
      parseControlTokens(JSON.stringify({ short: { operator: 'a', scope: 'read' } }))
    ).toThrow(/shorter than 16 characters/)
    expect(() => parseControlTokens(JSON.stringify({ [TOKEN]: { scope: 'read' } }))).toThrow(
      /names no operator/
    )
    expect(() =>
      parseControlTokens(JSON.stringify({ [TOKEN]: { operator: 'a', scope: 'root' } }))
    ).toThrow(/scope "root"/)
  })

  test('a token that the repository publishes is refused in production', () => {
    // The map of the example of the deployment is in the repository, and
    // the token it holds is published: a control plane that accepts it is
    // a control plane that everybody controls.
    const map = JSON.stringify({
      'replace-this-with-a-token-of-at-least-16-characters': {
        operator: 'the-operator-of-the-deployment',
        scope: 'read',
      },
    })
    expect(() => parseControlTokens(map, { production: true })).toThrow(
      /is the value of the example of the repository/
    )
    // A development machine may use the map of the example.
    const tokens = parseControlTokens(map)
    expect(tokens.size).toBe(1)
    expect(isPublishedControlToken('replace-this-with-a-token-of-at-least-16-characters')).toBe(
      true
    )
    expect(isPublishedControlToken(TOKEN)).toBe(false)
  })
})
