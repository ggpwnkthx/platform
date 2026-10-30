#!/usr/bin/env bun
/**
 * The redaction of the logs of the platform.
 *
 * The four processes of the platform write logs, and a credential never
 * reaches a log line: a token, a secret, a cookie or a password is
 * held back before the line is written, whatever the layer that writes
 * it.
 *
 * The lists of the names that are held back were written one process at
 * a time, and they drifted: a name that one process held back and the
 * next one did not is a credential that reaches a log of a deployment
 * that reads it.
 *
 * The check reads the list of every logger of the platform and refuses
 * the one that does not hold the canonical list back. It does not import
 * the code it checks: it reads the source.
 *
 *   bun run scripts/check-redaction.ts
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { redactionOf, REDACTION_SOURCES, type RedactionFinding } from '../tooling/redaction'

/** The root of the repository. */
const root = resolve(import.meta.dir, '..')

/** The main of the check. */
async function main(): Promise<void> {
  const findings: RedactionFinding[] = []
  for (const source of REDACTION_SOURCES) {
    const content = await readFile(join(root, source.path), 'utf8')
    findings.push(...redactionOf(source.path, source, content))
  }
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(
        `${finding.file}: the logger of ${finding.role} does not redact "${finding.name}", and ${finding.set} has to hold it back`
      )
    }
    console.error(`${findings.length} names that a logger of the platform does not redact`)
    process.exit(1)
  }
  console.log(
    `the ${REDACTION_SOURCES.length} loggers of the platform hold the names that carry a credential back`
  )
}

if (import.meta.main) await main()
