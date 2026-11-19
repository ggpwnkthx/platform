import { describe, expect, test } from 'bun:test'
import { versionProblem } from '../src/version.ts'

/**
 * The interface and the installation are one version: the interface reads the platform's
 * schema, and a schema of another version is not one it knows.
 */
describe('the version of the installation', () => {
  test('the same version is no problem', () => {
    expect(versionProblem('2.2.0', '2.2.0')).toBeNull()
  })

  test('an older installation is named, and the way to fix it', () => {
    const problem = versionProblem('2.1.0', '2.2.0')
    expect(problem).toContain('2.1.0')
    expect(problem).toContain('2.2.0')
    expect(problem).toContain('bun run cli migrate')
  })

  test('an installation the interface is behind for cannot be read', () => {
    const problem = versionProblem('2.3.0', '2.2.0')
    expect(problem).toContain('2.3.0')
    expect(problem).toContain('behind')
  })

  test('an installation that says nothing, or an interface that knows no version, is no problem', () => {
    expect(versionProblem(null, '2.2.0')).toBeNull()
    expect(versionProblem(undefined, '2.2.0')).toBeNull()
    expect(versionProblem('2.1.0', '')).toBeNull()
  })

  test('versions are compared by their parts, not as words', () => {
    expect(versionProblem('2.10.0', '2.9.0')).toContain('behind')
    expect(versionProblem('2.2.0', '2.2.1')).toContain('bun run cli migrate')
  })
})
