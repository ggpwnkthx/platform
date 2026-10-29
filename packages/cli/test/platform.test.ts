import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DryRunHttp, FetchHttp } from '../src/platform/http'
import { FileCredentialStore, FileProfileStore } from '../src/platform/files'

describe('the transport of the CLI', () => {
  test('a dry run sends nothing and answers the request it would have sent', async () => {
    const http = new DryRunHttp()
    const answer = await http.send({
      method: 'PUT',
      url: 'https://control.example.com/v1/config',
      body: JSON.stringify({ version: 1 }),
    })
    expect(answer.status).toBe(200)
    const body = JSON.parse(answer.body) as { dryRun: boolean; method: string; body: unknown }
    expect(body.dryRun).toBe(true)
    expect(body.method).toBe('PUT')
    expect(body.body).toEqual({ version: 1 })
  })

  test('a service that cannot be reached is a failure the reader is told about', async () => {
    const http = new FetchHttp(2000)
    try {
      await http.send({ method: 'GET', url: 'http://127.0.0.1:1/nothing' })
      throw new Error('the call was answered')
    } catch (error) {
      expect((error as { exit?: number }).exit).toBe(7)
    }
  })
})

describe('the files of the CLI', () => {
  test('the profiles of the machine are written and read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-'))
    const store = new FileProfileStore(join(directory, 'config.json'))
    expect(await store.read()).toEqual({ profiles: {} })
    await store.write({
      current: 'dev',
      profiles: { dev: { gatewayUrl: 'http://127.0.0.1:8080' } },
    })
    const profiles = await store.read()
    expect(profiles.current).toBe('dev')
    expect(profiles.profiles.dev?.gatewayUrl).toBe('http://127.0.0.1:8080')
  })

  test('the file of the profiles holds a secret, and it is read by its owner only', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-'))
    const path = join(directory, 'config.json')
    const store = new FileProfileStore(path)
    await store.write({ profiles: { dev: { clientSecret: 'the-secret' } } })
    const info = await stat(path)
    expect(info.mode & 0o777).toBe(0o600)
  })

  test('the credential of the caller is written, read and removed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-'))
    const path = join(directory, 'credentials.json')
    const store = new FileCredentialStore(path)
    expect(await store.read()).toBeNull()
    await store.write({ accessToken: 'the-token', subject: '00u1' })
    const credential = await store.read()
    expect(credential?.accessToken).toBe('the-token')
    expect(credential?.subject).toBe('00u1')
    const info = await stat(path)
    expect(info.mode & 0o777).toBe(0o600)
    await store.clear()
    expect(await store.read()).toBeNull()
  })

  test('a file that is not json is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platformctl-'))
    const path = join(directory, 'config.json')
    await Bun.write(path, 'not json')
    const store = new FileProfileStore(path)
    try {
      await store.read()
      throw new Error('the file was read')
    } catch (error) {
      expect((error as { exit?: number }).exit).toBe(8)
    }
    expect(await readFile(path, 'utf8')).toBe('not json')
  })
})
