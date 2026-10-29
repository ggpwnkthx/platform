import { describe, expect, test } from 'bun:test'
import { run, scanWords, type CliRuntime } from '../src/app/cli'
import type { CommandSpec, GroupSpec, Services } from '../src/app/commands'
import { CliFailure } from '../src/domains/failure'
import { FakeHttp } from './support'

/** The commands of the test. */
const hello: CommandSpec = {
  name: 'hello',
  summary: 'say hello',
  options: [{ name: 'name', kind: 'string', summary: 'the name' }],
  async run(input) {
    return { value: { hello: String(input.options.name ?? 'world') } }
  },
}

const failing: CommandSpec = {
  name: 'failing',
  summary: 'fail',
  async run() {
    throw new CliFailure('the service refused', 7, 'unreachable')
  },
}

const group: GroupSpec = {
  name: 'greet',
  summary: 'the greetings',
  commands: [hello, failing],
}

/** The services of the test. */
function servicesOf(): Services {
  return {
    http: new FakeHttp(),
    profiles: { read: async () => ({ profiles: {} }), write: async () => undefined },
    credentials: {
      read: async () => null,
      write: async () => undefined,
      clear: async () => undefined,
    },
    browser: { open: async () => undefined },
    callback: {
      start: async () => ({
        redirectUri: 'http://127.0.0.1:8765/callback',
        wait: async () => ({ code: 'the-code', state: 'the-state' }),
      }),
    },
    crypto: {
      randomBytes: (size: number) => new Uint8Array(size).fill(7),
      sha256: (value: Uint8Array) => new Uint8Array(value.length).fill(9),
    },
    files: { profiles: '/tmp/profiles.json', credentials: '/tmp/credentials.json' },
  }
}

/** The runtime of the test. */
function runtimeOf(): { runtime: CliRuntime; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    runtime: {
      name: 'platformctl',
      commands: [],
      groups: [group],
      environment: {},
      services: () => servicesOf(),
      contextOf: async () => ({ name: 'default' }),
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    },
  }
}

describe('the words of the reader', () => {
  test('the scan finds the words that are not options', () => {
    expect(scanWords(['--output', 'json', 'greet', 'hello'])).toEqual(['greet', 'hello'])
  })

  test('the scan does not take the value of a known option for a word', () => {
    expect(scanWords(['greet', 'hello', '--profile', 'prod'])).toEqual(['greet', 'hello'])
  })

  test('the scan takes the value of an unknown option for a word', () => {
    expect(scanWords(['greet', 'hello', '--body', './body.json'])).toEqual(['greet', 'hello'])
  })
})

describe('the dispatcher of the CLI', () => {
  test('a command is found and answered', async () => {
    const { runtime, out } = runtimeOf()
    const status = await run(runtime, ['greet', 'hello', '--name', 'alice'])
    expect(status).toBe(0)
    expect(out.join('\n')).toContain('hello: alice')
  })

  test('the help is printed when the reader asks for it', async () => {
    const { runtime, out } = runtimeOf()
    const status = await run(runtime, ['help', 'greet'])
    expect(status).toBe(0)
    expect(out.join('\n')).toContain('say hello')
  })

  test('the help of a command names its options', async () => {
    const { runtime, out } = runtimeOf()
    await run(runtime, ['greet', 'hello', '--help'])
    expect(out.join('\n')).toContain('--name')
  })

  test('a command that is not there is a usage error', async () => {
    const { runtime } = runtimeOf()
    await expect(run(runtime, ['nope'])).rejects.toBeInstanceOf(CliFailure)
  })

  test('the refusal of a command ends the process with its status', async () => {
    const { runtime } = runtimeOf()
    try {
      await run(runtime, ['greet', 'failing'])
      throw new Error('the command was answered')
    } catch (error) {
      expect((error as CliFailure).exit).toBe(7)
    }
  })

  test('the format of the answer is the one the reader names', async () => {
    const { runtime, out } = runtimeOf()
    await run(runtime, ['greet', 'hello', '--output', 'yaml'])
    expect(out.join('\n')).toContain('hello: world')
  })
})
