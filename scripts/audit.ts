#!/usr/bin/env bun
/**
 * The audit of the dependencies of the platform.
 *
 * The audit reads the lockfile of the repository and it reports the
 * advisories of the tree. Every advisory is a finding, and the only
 * exception is an advisory that the list of the accepted advisories names
 * with a reason and with a day.
 *
 * The command prints the findings and the exceptions, and it exits with a
 * status of 1 when there is a finding.
 *
 *   bun run audit
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acceptedAdvisories, auditFindings, staleAcceptances } from '../tooling/audit'
import type { AcceptedAdvisory, AuditReport } from '../tooling/audit'
import { repositoryOf } from '../tooling/ci'

/** The root of the repository. */
const root = repositoryOf(import.meta.dir)

/** The list of the accepted advisories. */
const ACCEPTED = join(root, 'scripts', 'audit-accepted.json')

/** The main of the audit. */
async function main(): Promise<number> {
  const process_ = Bun.spawn(['bun', 'audit', '--json'], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const output = await new Response(process_.stdout).text()
  const errors = await new Response(process_.stderr).text()
  const status = await process_.exited
  if (status !== 0 && output.trim() === '') {
    console.error(errors.trim() || 'the audit of the dependencies could not be run')
    return 1
  }

  let report: AuditReport
  try {
    report = JSON.parse(output) as AuditReport
  } catch {
    console.error('the answer of the audit could not be read')
    return 1
  }

  const accepted = JSON.parse(readFileSync(ACCEPTED, 'utf8')) as AcceptedAdvisory[]

  for (const stale of staleAcceptances(report, accepted)) {
    console.log(
      `the acceptance of ${stale.package} (${stale.advisory}) names an advisory the tree does not hold any more: it may be removed`
    )
  }

  for (const entry of acceptedAdvisories(report, accepted)) {
    console.log(
      `accepted until ${entry.acceptance.until}: ${entry.package} — ${entry.advisory.title} (${entry.advisory.severity})`
    )
  }

  const findings = auditFindings(report, accepted)
  for (const finding of findings) {
    console.error(
      `${finding.package}: ${finding.advisory.title} (${finding.advisory.severity}) — ${finding.advisory.url}\n  ${finding.reason}`
    )
  }
  if (findings.length > 0) {
    console.error(`${findings.length} advisories of the tree are not accepted`)
    return 1
  }
  console.log('the tree of the platform holds no advisory that is not accepted')
  return 0
}

process.exit(await main())
