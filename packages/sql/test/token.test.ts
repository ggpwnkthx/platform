import { describe, expect, test } from 'bun:test'
import {
  claims,
  compareVersions,
  expiresAt,
  roleOf,
  transaction,
  versionMismatch,
} from '../src/index.ts'

/**
 * The tokens and the versions the platform trusts, read the same way on both sides of the
 * wire: the operator's tools read a token to learn which role to ask for, and the interface
 * reads one to learn the same.
 */
describe('the token a sign-in carries', () => {
  const token = (claims: unknown) =>
    `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`

  test('the claims are read without verifying them', () => {
    expect(claims(token({ email: 'alice@example.com', exp: 1893456000 }))).toEqual({
      email: 'alice@example.com',
      exp: 1893456000,
    })
    expect(claims('not a token')).toEqual({})
    expect(claims(token(null))).toEqual({})
  })

  test('the role a token names is the claim PostgreSQL matches', () => {
    const mine = token({ email: 'alice@example.com', preferred_username: 'alice' })
    expect(roleOf(mine, 'email')).toBe('alice@example.com')
    expect(roleOf(mine, 'preferred_username')).toBe('alice')
    expect(roleOf(mine, 'name')).toBeNull()
  })

  test('a name PostgreSQL would refuse is no name at all', () => {
    expect(roleOf(token({ email: 'x'.repeat(64) }), 'email')).toBeNull()
    expect(roleOf(token({ email: 'a\0b' }), 'email')).toBeNull()
    expect(roleOf(token({ email: 7 }), 'email')).toBeNull()
  })

  test('a token says when it stops being a login', () => {
    expect(expiresAt(token({ exp: 1893456000 }))).toBe(1893456000000)
    expect(expiresAt(token({}))).toBeNull()
  })
})

describe('the version of the installation', () => {
  test('versions are compared by their parts, not as words', () => {
    expect(compareVersions('2.2.0', '2.2.0')).toBe(0)
    expect(compareVersions('2.10.0', '2.9.0')).toBe(1)
    expect(compareVersions('2.1.0', '2.2.0')).toBe(-1)
    expect(compareVersions('2.2', '2.2.0')).toBe(0)
  })

  test('an installation of another version is older or newer, and nothing else', () => {
    expect(versionMismatch('2.2.0', '2.2.0')).toBeNull()
    expect(versionMismatch('2.1.0', '2.2.0')).toBe('older')
    expect(versionMismatch('2.3.0', '2.2.0')).toBe('newer')
    expect(versionMismatch(null, '2.2.0')).toBeNull()
    expect(versionMismatch('2.1.0', '')).toBeNull()
  })
})

describe('a transaction', () => {
  test('the statements happen, or none of them do', async () => {
    const said: string[] = []
    const q = { query: async (text: string) => void said.push(text) }
    await expect(transaction(q, async () => 'done')).resolves.toBe('done')
    expect(said).toEqual(['BEGIN', 'COMMIT'])
  })

  test('a failure rolls the whole thing back', async () => {
    const said: string[] = []
    const q = { query: async (text: string) => void said.push(text) }
    await expect(
      transaction(q, async () => {
        throw new Error('no')
      })
    ).rejects.toThrow('no')
    expect(said).toEqual(['BEGIN', 'ROLLBACK'])
  })
})
