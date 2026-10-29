import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { checkWebArchitecture } from '../../../tooling/web-architecture'
import { CLI_RULES } from '../scripts/architecture'

describe('the architecture of the CLI', () => {
  test('the core imports neither the interface nor the platform, and nothing is a cycle', async () => {
    const problems = await checkWebArchitecture(resolve(import.meta.dir, '..'), CLI_RULES)
    expect(problems).toEqual([])
  })
})
