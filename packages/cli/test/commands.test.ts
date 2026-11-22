import { describe, expect, test } from 'bun:test'
import { DATABASE_COMMANDS, databaseCommand } from '../src/commands.ts'
import { connection } from '../src/connection.ts'
import { HELP } from '../src/help.ts'
import { deviceToken } from '../src/token.ts'
import { UI_HELP } from '../src/ui/help.ts'
import { VERSION } from '../src/version.ts'
import { silent, restore } from './commands-helpers.ts'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type pg from 'pg'

/**
 * The commands that speak to the database, and the two things that guard the way in to it:
 * the help that names every command, and the connection that acts as the person who is
 * signed in. What is tested here is what is said before the database is asked anything, and
 * what the connection refuses before it opens.
 */

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
