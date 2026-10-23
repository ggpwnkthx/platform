import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkClientArchitecture } from '../scripts/architecture'

/**
 * The architecture of the client.
 *
 * The client is published: it is installed by the consumers of the
 * backend, outside of this repository. The rules it obeys are the ones
 * of `scripts/architecture.ts`, and they are the reason a consumer can
 * install it and use it without anything else.
 */
describe('the architecture of the client', () => {
  test('the source of the client is standalone', async () => {
    const problems = await checkClientArchitecture()
    expect(problems).toEqual([])
  })

  test('a dependency is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'client-architecture-'))
    try {
      await writeFile(
        join(directory, 'client.ts'),
        "import { z } from 'zod'\nexport const value = z.string()\n"
      )
      const problems = await checkClientArchitecture(directory)
      expect(problems).toHaveLength(1)
      expect(problems[0]?.message).toContain('the client has no dependency')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('an import of the source of the service is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'client-architecture-'))
    try {
      await writeFile(
        join(directory, 'client.ts'),
        "import { ServiceError } from '../../src/protocol/errors'\nexport const error = ServiceError\n"
      )
      const problems = await checkClientArchitecture(directory)
      expect(problems).toHaveLength(1)
      expect(problems[0]?.message).toContain('the source of the service')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a cycle is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'client-architecture-'))
    try {
      await writeFile(join(directory, 'a.ts'), "import { b } from './b'\nexport const a = b\n")
      await writeFile(join(directory, 'b.ts'), "import { a } from './a'\nexport const b = a\n")
      const problems = await checkClientArchitecture(directory)
      expect(problems.some((problem) => problem.message.includes('cycle'))).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
