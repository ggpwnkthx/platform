#!/usr/bin/env bun
/**
 * The vocabulary of the services of the platform.
 *
 * The services are named by their role, and the identifiers of a
 * service carry the name of that role: the prefixes of its environment,
 * the names of its metrics and the name it answers with.
 *
 * The names they carried before were the names of the repositories they
 * were published from, and those repositories are gone: an identifier
 * that carries one of them is an identifier that nothing reads. The
 * check does not name them: it refuses every identifier whose name is
 * not the name of the role of its service.
 *
 *   bun run scripts/check-vocabulary.ts
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { vocabularyOf, VOCABULARY_SOURCES, type VocabularyFinding } from '../tooling/vocabulary'

/** The root of the repository. */
const root = resolve(import.meta.dir, '..')

/** The main of the check. */
async function main(): Promise<void> {
  const findings: VocabularyFinding[] = []
  for (const source of VOCABULARY_SOURCES) {
    const content = await readFile(join(root, source.path), 'utf8')
    findings.push(...vocabularyOf(source.path, source.role, source.kind, content))
  }
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(
        `${finding.file}:${finding.line} names ${finding.name}, and the name of the role is ${finding.expected}`
      )
    }
    console.error(`${findings.length} identifiers that do not carry the name of their role`)
    process.exit(1)
  }
  console.log(
    `the ${VOCABULARY_SOURCES.length} files that name the services name them by their role`
  )
}

if (import.meta.main) await main()
