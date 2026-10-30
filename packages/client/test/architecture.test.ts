import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkClientArchitecture, STANDALONE_RULES } from '../../../tooling/client-architecture'

/**
 * The architecture of the client of the platform.
 *
 * The client is imported by the console and by the CLI, and it speaks to
 * the services over HTTP. The rules it obeys are the ones of
 * `tooling/client-architecture.ts`.
 */
describe('the architecture of the client', () => {
  test('the source of the client holds its boundaries', async () => {
    const problems = await checkClientArchitecture(
      join(import.meta.dir, '..', 'src'),
      STANDALONE_RULES
    )
    expect(problems).toEqual([])
  })

  test('a dependency is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-client-architecture-'))
    try {
      await writeFile(
        join(directory, 'client.ts'),
        "import { z } from 'zod'\nexport const value = z.string()\n"
      )
      const problems = await checkClientArchitecture(directory, STANDALONE_RULES)
      expect(problems).toHaveLength(1)
      expect(problems[0]?.message).toContain('the client has no dependency')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a catch-all directory is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-client-architecture-'))
    try {
      await mkdir(join(directory, 'shared'))
      await writeFile(join(directory, 'shared', 'shared.ts'), 'export const shared = 1\n')
      const problems = await checkClientArchitecture(directory, STANDALONE_RULES)
      expect(problems.some((problem) => problem.message.includes('catch-all'))).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a cycle is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-client-architecture-'))
    try {
      await writeFile(join(directory, 'a.ts'), "import { b } from './b'\nexport const a = b\n")
      await writeFile(join(directory, 'b.ts'), "import { a } from './a'\nexport const b = a\n")
      const problems = await checkClientArchitecture(directory, STANDALONE_RULES)
      expect(problems.some((problem) => problem.message.includes('cycle'))).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
