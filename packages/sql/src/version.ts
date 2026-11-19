/**
 * The version of the platform, compared the same way on both sides.
 *
 * The installation holds the truth about its own version; the interface and the operator's
 * tools were built for one. A schema of another version is not one they know — a field's
 * metadata, for instance, is a column the platform added in 2.2.0.
 */

/** The parts of a version, as numbers. A part that is not a number counts as zero. */
function parts(version: string): number[] {
  return version.split('.').map((part) => Number(part) || 0)
}

/** Is the first version older than the second? */
export function older(one: string, other: string): boolean {
  return compareVersions(one, other) < 0
}

/** -1, 0 or 1: is the first version older than, the same as, or newer than the second? */
export function compareVersions(one: string, other: string): number {
  const left = parts(one)
  const right = parts(other)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
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
