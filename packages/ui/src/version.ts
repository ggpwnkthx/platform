import { versionMismatch } from '@platform/sql'

/**
 * The version of the platform this interface was built for.
 *
 * The build writes it into the bundle, so that the interface knows what the installation
 * must be. The interface and the installation are one version: the interface reads the
 * platform's schema, and a schema of another version is not one it knows — a field's
 * metadata, for instance, is a column the platform added in 2.2.0.
 *
 * The comparison itself is the platform's own, written once for the operator's tools and
 * the interface alike.
 */
export const builtVersion = process.env.PLATFORM_VERSION ?? ''

/**
 * What is wrong when the installation is not the version this interface was built for, or
 * nothing when it is. The database holds the truth about its own version; the interface was
 * built for one.
 */
export function versionProblem(
  installation: string | null | undefined,
  built = builtVersion
): string | null {
  const mismatch = versionMismatch(installation, built)
  if (!mismatch) return null
  if (mismatch === 'older')
    return `This installation is at version ${installation} and the interface at ${built}. Run \`bun run cli migrate\` to install ${built}.`
  return `This installation is at version ${installation} and the interface at ${built}. The interface is behind the installation, and cannot read it.`
}
