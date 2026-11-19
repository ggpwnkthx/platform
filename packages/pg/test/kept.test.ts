import { describe, expect, test } from 'bun:test'
import { KeptSession } from '../src/kept.ts'
import { ConnectionError, type Login } from '../src/wire.ts'

/**
 * The logins a client keeps: one for the whole of its work, not one for every action.
 */
function fakeDb(): Login & { closed: boolean } {
  const db = {
    async query() {
      return { fields: [], rows: [], command: '', affected: null }
    },
    close() {
      db.closed = true
      db.isClosed = true
    },
    isClosed: false,
    closed: false,
  }
  return db
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('the logins a client keeps', () => {
  test('one login serves every action', async () => {
    let opened = 0
    const kept = new KeptSession({
      open: async () => {
        opened++
        return fakeDb()
      },
      expiresAt: () => null,
    })
    expect(await kept.run(async () => 'first')).toBe('first')
    expect(await kept.run(async () => 'second')).toBe('second')
    expect(opened).toBe(1)
  })

  test('two actions at once get a login each', async () => {
    let opened = 0
    const kept = new KeptSession({
      size: 2,
      open: async () => {
        opened++
        return fakeDb()
      },
      expiresAt: () => null,
    })
    const results = await Promise.all([
      kept.run(async () => {
        await wait(20)
        return 'one'
      }),
      kept.run(async () => {
        await wait(20)
        return 'two'
      }),
    ])
    expect(results).toEqual(['one', 'two'])
    expect(opened).toBe(2)
  })

  test('an action waits for a login when they are all in use', async () => {
    let opened = 0
    const kept = new KeptSession({
      size: 1,
      open: async () => {
        opened++
        return fakeDb()
      },
      expiresAt: () => null,
    })
    const first = kept.run(async () => {
      await wait(20)
      return 'first'
    })
    const second = kept.run(async () => 'second')
    expect(await second).toBe('second')
    await first
    expect(opened).toBe(1)
  })

  test('a login the work has broken is thrown away', async () => {
    let opened = 0
    const kept = new KeptSession({
      open: async () => {
        opened++
        return fakeDb()
      },
      expiresAt: () => null,
    })
    await expect(
      kept.run(async () => {
        throw new ConnectionError('The connection to PostgreSQL closed')
      })
    ).rejects.toThrow('closed')
    expect(await kept.run(async () => 'again')).toBe('again')
    expect(opened).toBe(2)
  })

  test('a refused statement leaves the login alone', async () => {
    let opened = 0
    const kept = new KeptSession({
      open: async () => {
        opened++
        return fakeDb()
      },
      expiresAt: () => null,
    })
    const db = await kept.acquire()
    kept.release(db)
    await expect(
      kept.run(async () => {
        throw new Error('a statement was refused')
      })
    ).rejects.toThrow('refused')
    expect(opened).toBe(1)
  })

  test('the logins are closed when the sign-in expires', async () => {
    const db = fakeDb()
    const kept = new KeptSession({
      open: async () => db,
      expiresAt: () => Date.now() + 20,
    })
    await kept.run(async () => 'work')
    expect(db.closed).toBe(false)
    await wait(60)
    expect(db.closed).toBe(true)
  })

  test('no login is opened after the session has ended', async () => {
    let opened = 0
    const kept = new KeptSession({
      open: async () => {
        opened++
        return fakeDb()
      },
      expiresAt: () => null,
    })
    kept.close()
    await expect(kept.run(async () => 'work')).rejects.toThrow('sign-in has ended')
    expect(opened).toBe(0)
  })
})
