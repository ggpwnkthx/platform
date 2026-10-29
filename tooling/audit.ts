/**
 * The audit of the dependencies.
 *
 * The continuous integration runs the audit of the tree of the platform, and
 * it runs it on every advisory, not only on the critical ones: a moderate
 * advisory that is fixed by a version bump is a version bump.
 *
 * An advisory that cannot be fixed is an exception, and an exception that
 * is not written down is a silent one. The list of the accepted advisories
 * is therefore a file of the repository: it names the advisory, it says why
 * the advisory is accepted, and it says until when. An exception that is
 * not on the list stops the build, and an exception whose date is past
 * stops the build too.
 *
 * The audit itself is the audit of the runtime: `bun audit --json` reads the
 * lockfile of the repository and it answers the advisories of the tree. This
 * module reads that answer and it decides what is a finding.
 */

/** The severity of an advisory, as the audit of the runtime names it. */
export type AdvisorySeverity = 'low' | 'moderate' | 'high' | 'critical'

/** An advisory of the audit of the runtime. */
export interface Advisory {
  /** The identifier of the advisory in the database of the runtime. */
  readonly id: number
  /** The url of the advisory. */
  readonly url: string
  /** The title of the advisory. */
  readonly title: string
  /** The severity of the advisory. */
  readonly severity: AdvisorySeverity
  /** The versions the advisory covers. */
  readonly vulnerable_versions?: string
  /** The weaknesses the advisory maps to. */
  readonly cwe?: readonly string[]
  /** The score of the advisory. */
  readonly cvss?: { readonly score: number; readonly vectorString?: string }
}

/** The answer of the audit of the runtime: the advisories of every package. */
export type AuditReport = Record<string, readonly Advisory[]>

/** An advisory that the deployment of the platform accepts. */
export interface AcceptedAdvisory {
  /** The package the advisory is about. */
  readonly package: string
  /** The url of the advisory. */
  readonly advisory: string
  /**
   * Why the advisory is accepted.
   *
   * The reason is read by the operator of the repository: it says why the
   * advisory cannot be fixed now, and it names the way out of it.
   */
  readonly reason: string
  /**
   * The day the acceptance ends.
   *
   * The acceptance of an advisory is a decision that is taken again: a
   * date in the past means that the decision was not taken again, and the
   * advisory is a finding.
   */
  readonly until: string
}

/**
 * A finding of the audit.
 *
 * It is an advisory that the tree holds and that the list of the accepted
 * advisories does not cover, or that it covers past its date.
 */
export interface AuditFinding {
  /** The package the advisory is about. */
  readonly package: string
  /** The advisory. */
  readonly advisory: Advisory
  /** Why the advisory is a finding. */
  readonly reason: string
}

/**
 * The findings of an audit.
 *
 * The accepted advisories are not findings: they are reported apart, so an
 * operator sees the exceptions that the deployment runs with.
 */
export function auditFindings(
  report: AuditReport,
  accepted: readonly AcceptedAdvisory[],
  today: Date = new Date()
): AuditFinding[] {
  const findings: AuditFinding[] = []
  for (const [name, advisories] of Object.entries(report)) {
    for (const advisory of advisories) {
      const exception = accepted.find(
        (entry) => entry.package === name && entry.advisory === advisory.url
      )
      if (!exception) {
        findings.push({
          package: name,
          advisory,
          reason: 'the advisory is not on the list of the accepted advisories',
        })
        continue
      }
      const until = new Date(`${exception.until}T00:00:00Z`)
      if (Number.isNaN(until.getTime())) {
        findings.push({
          package: name,
          advisory,
          reason: `the acceptance of the advisory names a day that cannot be read: ${exception.until}`,
        })
        continue
      }
      if (until.getTime() < today.getTime()) {
        findings.push({
          package: name,
          advisory,
          reason: `the acceptance of the advisory ended on ${exception.until} and it was not taken again`,
        })
      }
    }
  }
  return findings.sort((left, right) =>
    left.package === right.package
      ? left.advisory.id - right.advisory.id
      : left.package.localeCompare(right.package)
  )
}

/**
 * The advisories of the tree that the list of the accepted advisories
 * covers.
 *
 * They are the exceptions the deployment runs with: they are reported, and
 * they are not findings.
 */
export function acceptedAdvisories(
  report: AuditReport,
  accepted: readonly AcceptedAdvisory[]
): { package: string; advisory: Advisory; acceptance: AcceptedAdvisory }[] {
  const entries: { package: string; advisory: Advisory; acceptance: AcceptedAdvisory }[] = []
  for (const [name, advisories] of Object.entries(report)) {
    for (const advisory of advisories) {
      const exception = accepted.find(
        (entry) => entry.package === name && entry.advisory === advisory.url
      )
      if (exception) entries.push({ package: name, advisory, acceptance: exception })
    }
  }
  return entries
}

/**
 * The accepted advisories that the tree does not hold any more.
 *
 * An exception that names an advisory the tree does not have is an
 * exception that nobody looked at: it is reported, so it is removed when
 * the dependency is fixed.
 */
export function staleAcceptances(
  report: AuditReport,
  accepted: readonly AcceptedAdvisory[]
): AcceptedAdvisory[] {
  return accepted.filter(
    (exception) =>
      !Object.entries(report).some(
        ([name, advisories]) =>
          name === exception.package &&
          advisories.some((advisory) => advisory.url === exception.advisory)
      )
  )
}
