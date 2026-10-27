import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { checkVersionConsistency, checkVersions } from '../scripts/version'

/**
 * The version of the platform.
 *
 * The platform has one version line: the version of the repository, of
 * the tag, of the three images, of the three binaries and of the three
 * specifications. These tests prove that the number is the same
 * everywhere.
 */
const root = join(import.meta.dir, '..')

describe('the version of the platform', () => {
  test('it is the same in every file that holds it', async () => {
    const findings = await checkVersions(root)
    expect(findings).toEqual([])
  })

  test('a file that holds another version is reported', () => {
    const findings = checkVersionConsistency({
      'package.json': JSON.stringify({ version: '1.0.0' }),
      'packages/gateway/Dockerfile': 'ARG VERSION=0.9.0\n',
    })
    expect(findings).toEqual([
      {
        file: 'packages/gateway/Dockerfile',
        message: 'the version is "0.9.0" and the package says "1.0.0"',
      },
    ])
  })

  test('a file that holds no version at all is reported', () => {
    const findings = checkVersionConsistency({
      'package.json': JSON.stringify({ version: '1.0.0' }),
      'packages/access/Dockerfile': '# no version here\n',
    })
    expect(findings).toEqual([
      { file: 'packages/access/Dockerfile', message: 'the version 1.0.0 could not be found' },
    ])
  })

  test('a package without a version is reported', () => {
    const findings = checkVersionConsistency({})
    expect(findings).toEqual([
      { file: 'package.json', message: 'the package does not hold a version' },
    ])
  })

  test('a version that is not the version of a release is reported', () => {
    const findings = checkVersionConsistency({
      'package.json': JSON.stringify({ version: '1.0' }),
    })
    expect(findings).toEqual([
      {
        file: 'package.json',
        message: 'the version "1.0" is not the version of a release: three numbers, "1.0.0"',
      },
    ])
  })
})
