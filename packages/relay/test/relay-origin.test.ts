import { describe, expect, test } from 'bun:test'
import { originAllowed } from '../src/relay.ts'

/**
 * The origin check, and the sessions that have not logged in.
 */

describe('the origin check', () => {
  const request = (origin?: string) =>
    new Request('https://relay.example.com/', {
      headers: origin ? { origin } : {},
    })
  test('allows an origin on the list and refuses every other', () => {
    expect(
      originAllowed(request('https://platform.example.com'), ['https://platform.example.com'])
    ).toBe(true)
    expect(
      originAllowed(request('https://other.example.com'), ['https://platform.example.com'])
    ).toBe(false)
    expect(originAllowed(request(), ['https://platform.example.com'])).toBe(false)
    expect(originAllowed(request('https://other.example.com'), [])).toBe(true)
  })
})
