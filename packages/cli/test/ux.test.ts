import { describe, expect, test } from 'bun:test'
import { run, type CliRuntime } from '../src/app/cli'
import { lineOf, paint } from '../src/app/color'
import type { CommandSpec, GroupSpec, Services } from '../src/app/commands'
import { CliFailure } from '../src/domains/failure'
import { closestOf, distanceOf } from '../src/app/suggest'
import { FakeHttp, FakeInfrastructure } from './support'

/** A command of the root of the test. */
const hello: CommandSpec = {
  name: 'hello',
  summary: 'say hello',
  options: [{ name: 'name', kind: 'string', summary: 'the name' }],
  async run(input) {
    return { value: { hello: String(input.options.name ?? 'world') } }
  },
}

/** A command of a group of the test. */
const greet: CommandSpec = {
  name: 'greet',
  summary: 'greet somebody',
  arguments: [{ name: 'name', summary: 'the name to greet', required: true }],
  async run() {
    return { value: { greeted: true } }
  },
}

/** Another command of the group of the test. */
const greetFormally: CommandSpec = {
  name: 'greet formally',
  summary: 'greet somebody in writing',
  async run() {
    return { value: { greeted: true } }
  },
}

/** The group of the test. */
const group: GroupSpec = {
  name: 'words',
  summary: 'the words',
  commands: [greet, greetFormally],
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
    infrastructure: new FakeInfrastructure(),
    files: { profiles: '/tmp/profiles.json', credentials: '/tmp/credentials.json' },
    progress: () => undefined,
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
      version: '1.2.3',
      commands: [hello],
      groups: [group],
      environment: {},
      services: () => servicesOf(),
      contextOf: async () => ({ name: 'default' }),
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    },
  }
}

describe('the help of the CLI', () => {
  test('the help of the root names the commands of the root', async () => {
    const { runtime, out } = runtimeOf()
    const status = await run(runtime, [])
    expect(status).toBe(0)
    expect(out.join('\n')).toContain('say hello')
  })

  test('the help of the root names the groups', async () => {
    const { runtime, out } = runtimeOf()
    await run(runtime, [])
    expect(out.join('\n')).toContain('the words')
  })

  test('the help of a group is not a refusal', async () => {
    const { runtime, out } = runtimeOf()
    const status = await run(runtime, ['words', '--help'])
    expect(status).toBe(0)
    expect(out.join('\n')).toContain('greet somebody')
  })

  test('the help of a group is what the reader gets when it asks for it', async () => {
    const { runtime, out } = runtimeOf()
    const status = await run(runtime, ['words', 'help'])
    expect(status).toBe(0)
    expect(out.join('\n')).toContain('greet somebody')
  })

  test('a group without a command is a usage error', async () => {
    const { runtime } = runtimeOf()
    expect(await run(runtime, ['words'])).toBe(2)
  })

  test('the help of a command names the program in its usage', async () => {
    const { runtime, out } = runtimeOf()
    await run(runtime, ['words', 'greet', '--help'])
    expect(out.join('\n')).toContain('platformctl words greet')
  })

  test('the columns of the help line up', async () => {
    const { runtime, out } = runtimeOf()
    await run(runtime, [])
    const lines = out.join('\n').split('\n')
    const summary = lines.find((line) => line.includes('say hello'))
    expect(summary).toBe('  hello  say hello')
  })
})

describe('the version of the CLI', () => {
  test('the reader asks for the version and gets it', async () => {
    const { runtime, out } = runtimeOf()
    const status = await run(runtime, ['--version'])
    expect(status).toBe(0)
    expect(out.join('\n')).toBe('platformctl 1.2.3')
  })
})

describe('the suggestion of the CLI', () => {
  test('the refusal of a word names the command that is the closest', async () => {
    const { runtime } = runtimeOf()
    try {
      await run(runtime, ['helo'])
      throw new Error('the command was answered')
    } catch (error) {
      expect(error).toBeInstanceOf(CliFailure)
      expect((error as CliFailure).hint).toContain('hello')
    }
  })

  test('the refusal of a word of a group names the commands that begin with it', async () => {
    const { runtime } = runtimeOf()
    try {
      await run(runtime, ['words', 'gre'])
      throw new Error('the command was answered')
    } catch (error) {
      expect((error as CliFailure).hint).toContain('words greet')
    }
  })

  test('the refusal of an option names the option that is the closest', async () => {
    const { runtime } = runtimeOf()
    try {
      await run(runtime, ['hello', '--nme', 'alice'])
      throw new Error('the command was answered')
    } catch (error) {
      expect((error as CliFailure).message).toContain('--name')
    }
  })

  test('the distance of two words is the number of edits between them', () => {
    expect(distanceOf('status', 'stat')).toBe(2)
    expect(distanceOf('status', 'status')).toBe(0)
  })

  test('the closest name is the one that begins with the word', () => {
    expect(closestOf('stat', ['login', 'status', 'version'])).toBe('status')
  })

  test('a name that is far from the word is no suggestion', () => {
    expect(closestOf('nope', ['login', 'status', 'version'])).toBeUndefined()
  })
})

describe('the refusal of a command', () => {
  test('the refusal of a missing argument names the command in full', async () => {
    const { runtime } = runtimeOf()
    try {
      await run(runtime, ['words', 'greet'])
      throw new Error('the command was answered')
    } catch (error) {
      expect((error as CliFailure).hint).toBe('run platformctl words greet --help')
    }
  })
})

describe('the colour of the answer', () => {
  test('a state is painted', () => {
    expect(lineOf('gateway (health)      ok', true)).toContain('\u001b[32mok')
  })

  test('a state is not painted when the answer is not painted', () => {
    expect(lineOf('gateway (health)      ok', false)).toBe('gateway (health)      ok')
  })

  test('the colour of a text is the escape of the colour', () => {
    expect(paint('ok', 'green', true)).toBe('\u001b[32mok\u001b[0m')
  })
})
