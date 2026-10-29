import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  acceptedAdvisories,
  auditFindings,
  staleAcceptances,
  type AcceptedAdvisory,
  type AuditReport,
} from '../tooling/audit'

/**
 * The audit of the dependencies.
 *
 * Every advisory of the tree is a finding, and the only exception is an
 * advisory that the list of the accepted advisories names with a reason and
 * with a day. The exceptions are visible, and an exception that nobody
 * looked at again stops the build.
 */
const report: AuditReport = {
  yaml: [
    {
      id: 1115556,
      url: 'https://github.com/advisories/GHSA-48c2-rrv3-qjmp',
      title: 'yaml is vulnerable to a stack overflow',
      severity: 'moderate',
    },
  ],
  '@hono/node-server': [
    {
      id: 1243661,
      url: 'https://github.com/advisories/GHSA-rmxm-3fg6-px4f',
      title: 'the path of the static files is decoded twice',
      severity: 'moderate',
    },
  ],
}

const accepted: AcceptedAdvisory[] = [
  {
    package: '@hono/node-server',
    advisory: 'https://github.com/advisories/GHSA-rmxm-3fg6-px4f',
    reason: 'the dependency is the dev server of the console',
    until: '2026-12-31',
  },
]

describe('the findings of the audit', () => {
  test('an advisory that is not accepted is a finding', () => {
    const findings = auditFindings(report, accepted, new Date('2026-01-01'))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.package).toBe('yaml')
    expect(findings[0]!.reason).toContain('not on the list')
  })

  test('an accepted advisory is not a finding', () => {
    const findings = auditFindings(report, accepted, new Date('2026-01-01'))
    expect(findings.map((finding) => finding.package)).not.toContain('@hono/node-server')
  })

  test('an acceptance that ended is a finding', () => {
    const findings = auditFindings(report, accepted, new Date('2027-01-01'))
    expect(findings).toHaveLength(2)
    const expired = findings.find((finding) => finding.package === '@hono/node-server')
    expect(expired?.reason).toContain('ended on 2026-12-31')
  })

  test('an acceptance that names a day that cannot be read is a finding', () => {
    const findings = auditFindings(
      report,
      [{ ...accepted[0]!, until: 'the day after tomorrow' }],
      new Date('2026-01-01')
    )
    const broken = findings.find((finding) => finding.package === '@hono/node-server')
    expect(broken?.reason).toContain('cannot be read')
  })

  test('the accepted advisories are reported apart', () => {
    const entries = acceptedAdvisories(report, accepted)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.package).toBe('@hono/node-server')
    expect(entries[0]!.acceptance.until).toBe('2026-12-31')
  })

  test('an acceptance that the tree does not hold any more is reported', () => {
    const stale = staleAcceptances(report, [
      ...accepted,
      {
        package: 'hono',
        advisory: 'https://github.com/advisories/GHSA-0000-0000-0000',
        reason: 'the advisory was fixed',
        until: '2026-12-31',
      },
    ])
    expect(stale).toHaveLength(1)
    expect(stale[0]!.package).toBe('hono')
  })
})

describe('the list of the accepted advisories of the repository', () => {
  test('every exception names the advisory, the reason and the day', async () => {
    const file = Bun.file(join(import.meta.dir, '..', 'scripts', 'audit-accepted.json'))
    const entries = JSON.parse(await file.text()) as AcceptedAdvisory[]
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.package.length).toBeGreaterThan(0)
      expect(entry.advisory).toMatch(/^https:\/\/github\.com\/advisories\//)
      expect(entry.reason.length).toBeGreaterThan(20)
      expect(entry.until).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // The day is in the future: an exception that nobody looked at again
      // is a finding, and the build stops.
      expect(new Date(`${entry.until}T00:00:00Z`).getTime()).toBeGreaterThan(Date.now())
    }
  })
})
