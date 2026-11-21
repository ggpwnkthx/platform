import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type pg from 'pg'
import { z } from 'zod'
import { main } from '../src/cli.ts'
import { DATABASE_COMMANDS, databaseCommand } from '../src/commands.ts'
import { connection } from '../src/connection.ts'
import { HELP } from '../src/help.ts'
import { inPage, sessionAuthorization } from '../src/in-page.ts'
import { deviceToken } from '../src/token.ts'
import { UI_HELP } from '../src/ui/help.ts'
import { VERSION } from '../src/version.ts'

/**
 * The commands that speak to the database, and the two things that guard the way in to it:
 * the help that names every command, and the connection that acts as the person who is
 * signed in. What is tested here is what is said before the database is asked anything, and
 * what the connection refuses before it opens.
 */

/** A client that answers nothing: a command that reaches the database has gone wrong here. */
const silent = {
  query: async () => {
    throw new Error('The database was asked a question it should not have been asked')
  },
} as unknown as pg.Client

/** The environment as it was, so that a test that changes it can put it back. */
const kept = { ...process.env }

/** Puts the environment back as it was. */
function restore() {
  for (const name of Object.keys(process.env)) if (!(name in kept)) delete process.env[name]
  for (const [name, value] of Object.entries(kept)) process.env[name] = value
}

describe('The commands that speak to the database', () => {
  test('are the ones that need one, and the help names every one of them', () => {
    expect(DATABASE_COMMANDS).toContain('migrate')
    expect(DATABASE_COMMANDS).toContain('apply')
    expect(DATABASE_COMMANDS).toContain('sql')
    for (const command of DATABASE_COMMANDS) expect(HELP).toContain(command)
  })

  test('the help says which version of the platform it is', () => {
    expect(HELP).toContain(VERSION)
    expect(HELP).toContain('PGTOKEN')
  })

  test('the help of the interface names what it can do', () => {
    expect(UI_HELP).toContain('platform ui <build|dev|serve>')
    expect(UI_HELP).toContain('platform.json')
  })

  test('apply says what it needs before it asks the database anything', async () => {
    await expect(databaseCommand(silent, 'apply', ['local'])).rejects.toThrow(
      'apply needs a deployment and at least one manifest file, --dir or --administrator'
    )
  })

  test('apply refuses an option it does not know', async () => {
    await expect(databaseCommand(silent, 'apply', ['local', '--bogus'])).rejects.toThrow(
      'Unknown option: --bogus'
    )
  })

  test('a command that runs a file says which file it needs', async () => {
    await expect(databaseCommand(silent, 'sql', [])).rejects.toThrow('sql needs a file path')
    await expect(databaseCommand(silent, 'model:apply', [])).rejects.toThrow(
      'model:apply needs a file path'
    )
  })

  test('a server too old to hold the platform is refused by name', async () => {
    const old = {
      query: async () => ({ rows: [{ n: 170000 }] }),
    } as unknown as pg.Client
    await expect(databaseCommand(old, 'doctor', [])).rejects.toThrow(
      'PostgreSQL 18 or newer is required; this server reports 17'
    )
  })
})

describe('The connection the operator’s commands use', () => {
  test('a deployment it does not know is refused by name', () => {
    try {
      expect(() => connection('quantum')).toThrow(
        'Unknown deployment: quantum. Supported deployments: local, k8s.'
      )
    } finally {
      restore()
    }
  })

  test('no login has a password, so a password given is refused', () => {
    process.env.PGPASSWORD = 'hunter2'
    try {
      expect(() => connection()).toThrow(
        'PGPASSWORD is not used: no login has a password. Sign in with a token.'
      )
    } finally {
      restore()
    }
  })

  test('a connection without a token is refused, and it says how to get one', () => {
    delete process.env.PGTOKEN
    delete process.env.PGTOKEN_FILE
    process.env.DATABASE_HOST = '127.0.0.1'
    try {
      expect(() => connection()).toThrow(
        'PGTOKEN or PGTOKEN_FILE is required: sign in with `bun run cli token` and pass what it prints.'
      )
    } finally {
      restore()
    }
  })

  test('a token file is read, and a token that names no role is refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'platform-token-'))
    const file = join(dir, 'token')
    writeFileSync(file, 'not-a-token\n')
    delete process.env.PGTOKEN
    process.env.PGTOKEN_FILE = file
    process.env.DATABASE_HOST = '127.0.0.1'
    try {
      expect(() => connection()).toThrow()
    } finally {
      restore()
    }
  })

  test('the server’s own socket is reached without a token, by the server’s superuser', () => {
    delete process.env.PGTOKEN
    delete process.env.PGTOKEN_FILE
    process.env.DATABASE_HOST = '/var/run/postgresql'
    try {
      const q = connection()
      expect(q).toBeDefined()
    } finally {
      restore()
    }
  })
})

describe('The sign-in from a terminal', () => {
  /** An issuer that offers the device flow, and says so. */
  function issuer(answer: (body: URLSearchParams) => Record<string, unknown>) {
    return Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === '/.well-known/openid-configuration')
          return Response.json({
            device_authorization_endpoint: `${url.origin}/device`,
            token_endpoint: `${url.origin}/token`,
          })
        const body = new URLSearchParams(await request.text())
        if (url.pathname === '/device')
          return Response.json({
            device_code: 'device-code',
            user_code: 'ABCD-EFGH',
            verification_uri: `${url.origin}/device`,
            verification_uri_complete: `${url.origin}/device?code=ABCD-EFGH`,
            interval: 0,
            expires_in: 60,
          })
        return Response.json(answer(body))
      },
    })
  }

  test('tells the reader where to go, and returns the token the issuer gives', async () => {
    const server = issuer(() => ({ access_token: 'a-token' }))
    try {
      const said: string[] = []
      const token = await deviceToken(server.url.origin, 'a-client', (message) =>
        said.push(message)
      )
      expect(token).toBe('a-token')
      expect(said.join(' ')).toContain('ABCD-EFGH')
    } finally {
      server.stop(true)
    }
  })

  test('an issuer that refuses the sign-in says so', async () => {
    const server = issuer(() => ({ error: 'access_denied' }))
    try {
      await expect(deviceToken(server.url.origin, 'a-client', () => {})).rejects.toThrow(
        'Sign-in failed: access_denied'
      )
    } finally {
      server.stop(true)
    }
  })
})

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
