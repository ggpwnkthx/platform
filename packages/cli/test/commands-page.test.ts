import { describe, expect, test } from 'bun:test'
import { main } from '../src/cli.ts'
import { inPage, sessionAuthorization } from '../src/in-page.ts'
import { VERSION } from '../src/version.ts'
import { restore } from './commands-helpers.ts'
import { z } from 'zod'

/**
 * The commands that speak to the database, and the two things that guard the way in to it:
 * the help that names every command, and the connection that acts as the person who is
 * signed in. What is tested here is what is said before the database is asked anything, and
 * what the connection refuses before it opens.
 */

describe('The page’s own database', () => {
  test('becomes the reader, and the reader’s name is quoted as a name', () => {
    expect(sessionAuthorization('alice')).toBe('SET SESSION AUTHORIZATION "alice"')
    // A role may hold a quote of its own: PostgreSQL reads it as one name, not as two.
    expect(sessionAuthorization('a"b')).toBe('SET SESSION AUTHORIZATION "a""b"')
    expect(sessionAuthorization('a"b; DROP TABLE x')).toBe(
      'SET SESSION AUTHORIZATION "a""b; DROP TABLE x"'
    )
  })
})

describe('The command the operator asked for', () => {
  test('the version is printed, and an unknown command is answered with the help', async () => {
    const said: string[] = []
    const log = console.log
    console.log = (...parts: unknown[]) => said.push(parts.map(String).join(' '))
    try {
      await main(['--version'])
      await main(['nonsense'])
    } finally {
      console.log = log
    }
    expect(said[0]).toBe(VERSION)
    expect(said[1]).toContain('platform <command>')
  })

  test('a command that needs the database says what it needs when there is no token', async () => {
    delete process.env.PGTOKEN
    delete process.env.PGTOKEN_FILE
    process.env.DATABASE_HOST = '127.0.0.1'
    try {
      await expect(main(['migrate'])).rejects.toThrow('PGTOKEN or PGTOKEN_FILE is required')
    } finally {
      restore()
    }
  })
})

describe('The schemas the page makes', () => {
  test('are made without compiling them, so the page compiles no script', async () => {
    const before = z.config()
    try {
      await import('../src/no-eval.ts')
      expect(z.config().jitless).toBe(true)
    } finally {
      z.config(before)
    }
  })
})

describe('The page’s own people', () => {
  test('are the manifest’s own, and the page keeps who was chosen', () => {
    const store = new Map<string, string>()
    globalThis.sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    } as unknown as Storage
    try {
      const page = inPage({
        models: {
          format: 1,
          users: [
            { name: 'alice', login: true },
            { name: 'a-group', login: false },
          ],
        },
        migration: undefined,
        demo: undefined,
      })
      // A person signs in; a group has no login of its own.
      expect(page.withoutIssuer.people.map((person) => person.role)).toEqual(['alice'])
      expect(page.withoutIssuer.chosen()).toBe(null)
      page.withoutIssuer.choose('alice')
      expect(page.withoutIssuer.chosen()).toBe('alice')
      page.withoutIssuer.forget()
      expect(page.withoutIssuer.chosen()).toBe(null)
    } finally {
      delete (globalThis as { sessionStorage?: Storage }).sessionStorage
    }
  })
})
