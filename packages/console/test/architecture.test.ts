import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { checkWebArchitecture } from '../../../tooling/web-architecture'
import { CONSOLE_RULES } from '../scripts/architecture'

describe('the architecture of the console', () => {
  test('the core imports neither the interface nor HonoX, and nothing is a cycle', async () => {
    const problems = await checkWebArchitecture(resolve(import.meta.dir, '..'), CONSOLE_RULES)
    expect(problems).toEqual([])
  })
})
