/**
 * The version of a release.
 *
 * The version of a release is written in several places, and they have
 * to name the same release: an image that carries another version
 * deploys something else than the one that was released.
 *
 * There is one version line. The three services were three
 * repositories, and each of them carried a version of its own; the
 * repositories are retired, and the line they carried is not continued
 * here. The platform has one version, and the status of a specification
 * is the release that carries it.
 *
 * This module is the engine of the check. It knows how to read a
 * version out of a file and how to compare the versions of a set of
 * files; the files themselves, and the paths they are named by, are the
 * configuration of the caller.
 */

/** A disagreement between two files about a version. */
export interface VersionFinding {
  /** The file the disagreement was found in. */
  file: string
  /** What the file says and what it should say. */
  message: string
}

/**
 * A file that holds a version, and how to read it.
 *
 * The reader is the configuration of the file: the version of a package
 * is in its `version`, the version of an image is in its `ARG VERSION`
 * and the version of a specification is in its `Status:`.
 */
export interface VersionSource {
  /** The path of the file, relative to the root of the check. */
  readonly path: string
  /** Reads the version out of the content of the file, or null when it holds none. */
  readonly read: (content: string) => string | null
}

/**
 * The shape of the version of a release: three numbers, nothing else.
 *
 * A pre-release is not the version of a release: the workflow of the
 * release refuses a tag that does not name one.
 */
export const RELEASE_VERSION = /^\d+\.\d+\.\d+$/

/** Reads the version of a release out of the content of a package. */
export function versionOfPackage(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

/**
 * The version of the package of a directory.
 *
 * It is the reference of every other version: the image, the service
 * and the specification have to name the same release.
 */
export async function readPackageVersion(root: string): Promise<string | null> {
  const content = await Bun.file(`${root}/package.json`)
    .text()
    .catch(() => null)
  return content === null ? null : versionOfPackage(content)
}

/**
 * Reads the files of the sources out of a directory.
 *
 * A file that is not there is not a disagreement: it is reported by
 * the check of the files that are.
 */
export async function readSources(
  root: string,
  sources: readonly VersionSource[]
): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const source of sources) {
    const content = await Bun.file(`${root}/${source.path}`)
      .text()
      .catch(() => null)
    if (content !== null) files[source.path] = content
  }
  return files
}

/**
 * Checks that the files hold the same version.
 *
 * The version of the first source is the reference: it is the one the
 * workflow of the release reads and the one the tag of the release
 * carries.
 */
export function checkVersionConsistency(
  files: Record<string, string>,
  sources: readonly VersionSource[]
): VersionFinding[] {
  const findings: VersionFinding[] = []
  const reference = sources[0]
  if (reference === undefined) return findings
  const content = files[reference.path]
  const version = content === undefined ? null : reference.read(content)
  if (version === null) {
    findings.push({ file: reference.path, message: 'the package does not hold a version' })
    return findings
  }
  if (!RELEASE_VERSION.test(version)) {
    findings.push({
      file: reference.path,
      message: `the version "${version}" is not the version of a release: three numbers, "1.0.0"`,
    })
    return findings
  }
  for (const source of sources) {
    const sourceContent = files[source.path]
    if (sourceContent === undefined) continue
    const found = source.read(sourceContent)
    if (found === null) {
      findings.push({
        file: source.path,
        message: `the version ${version} could not be found`,
      })
      continue
    }
    if (found !== version) {
      findings.push({
        file: source.path,
        message: `the version is "${found}" and the package says "${version}"`,
      })
    }
  }
  return findings
}
