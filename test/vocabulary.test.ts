import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  carriesTheRole,
  PLATFORM_VARIABLES,
  vocabularyOf,
  VOCABULARY,
  VOCABULARY_SOURCES,
} from '../tooling/vocabulary'

/**
 * The vocabulary of the services of the platform.
 *
 * The services are named by their role, and the identifiers of a service
 * carry the name of that role. The names they carried before were the
 * names of the repositories they were published from, and those
 * repositories are gone: an identifier that carries one of them is an
 * identifier that nothing reads.
 *
 * The check does not name the names that are gone: it refuses every
 * identifier whose name is not the name of the role of its service.
 */
const root = join(import.meta.dir, '..')

describe('the vocabulary of the services', () => {
  test('every identifier of the platform carries the name of its role', async () => {
    const problems: string[] = []
    for (const source of VOCABULARY_SOURCES) {
      const content = await readFile(join(root, source.path), 'utf8')
      for (const finding of vocabularyOf(source.path, source.role, source.kind, content)) {
        problems.push(`${finding.file}:${finding.line} names ${finding.name}`)
      }
    }
    expect(problems).toEqual([])
  })

  test('a variable that does not carry the prefix of the role is reported', () => {
    const findings = vocabularyOf(
      'packages/gateway/src/runtime/env/schema.ts',
      'gateway',
      'environment',
      '  GATEWAY_SESSION_SECRET: z.string().optional(),\n  GONE_SESSION_SECRET: z.string().optional(),\n'
    )
    expect(findings).toEqual([
      {
        file: 'packages/gateway/src/runtime/env/schema.ts',
        line: 2,
        name: 'GONE_SESSION_SECRET',
        expected: VOCABULARY.gateway.environment,
      },
    ])
  })

  test('a metric that does not carry the name of the role is reported', () => {
    const findings = vocabularyOf(
      'packages/gateway/src/observability/metrics.ts',
      'gateway',
      'metric',
      "      name: 'gone_requests_total',\n"
    )
    expect(findings).toEqual([
      {
        file: 'packages/gateway/src/observability/metrics.ts',
        line: 1,
        name: 'gone_requests_total',
        expected: VOCABULARY.gateway.metric,
      },
    ])
  })

  test('a service that does not answer with the name of its role is reported', () => {
    const findings = vocabularyOf(
      'packages/access/src/app/endpoints.ts',
      'access',
      'service',
      "    service: 'gone',\n"
    )
    expect(findings).toEqual([
      {
        file: 'packages/access/src/app/endpoints.ts',
        line: 1,
        name: 'gone',
        expected: VOCABULARY.access.service,
      },
    ])
  })

  test('the variables of the platform are the ones exception', () => {
    for (const variable of PLATFORM_VARIABLES) {
      expect(carriesTheRole('environment', 'gateway', variable)).toBe(true)
    }
  })

  test('a control plane carries the name of its role', () => {
    expect(carriesTheRole('service', 'gateway', 'gateway-control')).toBe(true)
    expect(carriesTheRole('service', 'gateway', 'gateway')).toBe(true)
    expect(carriesTheRole('service', 'gateway', 'control')).toBe(false)
  })
})
