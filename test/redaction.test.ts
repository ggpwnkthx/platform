import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  missingOf,
  namesOfSet,
  redactionOf,
  REDACTION_SOURCES,
  SENSITIVE_NAMES,
  SENSITIVE_QUERY_NAMES,
} from '../tooling/redaction'

/**
 * The redaction of the logs of the platform.
 *
 * A credential never reaches a log line, and the names that are held
 * back are written once, in `tooling/redaction.ts`. The check reads the
 * list of every logger of the platform and refuses the one that does
 * not hold it back.
 */
const root = join(import.meta.dir, '..')

describe('the redaction of the logs', () => {
  test('every logger of the platform holds the canonical list back', async () => {
    const findings = []
    for (const source of REDACTION_SOURCES) {
      const content = await readFile(join(root, source.path), 'utf8')
      findings.push(...redactionOf(source.path, source, content))
    }
    expect(findings).toEqual([])
  })

  test('the canonical list holds the names of every process', () => {
    // The list is the union of what the processes redact: a name that
    // one of them held back is in the list.
    for (const name of [
      'authorization',
      'cookie',
      'set-cookie',
      'token',
      'password',
      'secret',
      'x-gateway-signature',
      'x-access-token',
    ]) {
      expect(SENSITIVE_NAMES).toContain(name)
    }
    for (const name of ['code', 'code_verifier', 'state', 'refresh_token']) {
      expect(SENSITIVE_QUERY_NAMES).toContain(name)
    }
  })

  test('the names of a set are read out of its source', () => {
    const source = "const SENSITIVE = new Set([\n  'authorization',\n  'cookie',\n])"
    expect(namesOfSet(source, 'SENSITIVE')).toEqual(['authorization', 'cookie'])
  })

  test('a set that is not in the source holds nothing', () => {
    expect(namesOfSet("const OTHER = new Set(['x'])", 'SENSITIVE')).toEqual([])
  })

  test('a name that a logger does not redact is reported', () => {
    const source = "const SENSITIVE_HEADERS = new Set([\n  'authorization',\n])"
    expect(missingOf(source, 'SENSITIVE_HEADERS', SENSITIVE_NAMES)).toContain('token')
    expect(missingOf(source, 'SENSITIVE_HEADERS', SENSITIVE_NAMES)).not.toContain('authorization')
  })

  test('the name of a logger is reported with its file and its role', () => {
    const findings = redactionOf(
      'packages/console/src/runtime/log.ts',
      { path: 'packages/console/src/runtime/log.ts', role: 'console', set: 'SENSITIVE_FIELDS' },
      "const SENSITIVE_FIELDS = new Set([\n  'authorization',\n])"
    )
    expect(findings).toContainEqual({
      file: 'packages/console/src/runtime/log.ts',
      role: 'console',
      name: 'token',
      set: 'SENSITIVE_FIELDS',
    })
  })
})
