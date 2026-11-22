/**
 * The version of the platform, compared the same way on both sides.
 *
 * The installation holds the truth about its own version; the interface and the operator's
 * tools were built for one. A schema of another version is not one they know — a field's
 * metadata, for instance, is a column the platform added in 2.2.0.
 */
import { compareVersions as compare, validate } from 'compare-versions'

/** Is the first version older than the second? */
export function older(one: string, other: string): boolean {
  return compareVersions(one, other) < 0
}

/**
 * -1, 0 or 1: is the first version older than, the same as, or newer than the second?
 *
 * A version that is no version at all — an installation that says nothing, or says
 * something else — is no difference: there is nothing to compare, so nothing is found.
 */
export function compareVersions(one: string, other: string): number {
  if (!validate(one) || !validate(other)) return 0
  return compare(one, other)
}

/** How an installation differs from the version something was built for. */
export type VersionMismatch = 'older' | 'newer'

/**
 * How the installation differs from the version something was built for, or null when it
 * does not differ. An installation of no known version, or a build of no known version, has
 * nothing to compare.
 */
export function versionMismatch(
  installation: string | null | undefined,
  built: string | null | undefined
): VersionMismatch | null {
  if (!built || !installation) return null
  const compared = compareVersions(installation, built)
  if (compared === 0) return null
  return compared < 0 ? 'older' : 'newer'
}
