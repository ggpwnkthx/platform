/**
 * The release of the platform.
 *
 * A release carries the digest of every image it published, and a
 * deployment pins the digest of the image it runs. The wizard reads the
 * release instead of the operator copying a digest by hand: a digest
 * that is copied is a digest that is wrong the day the tag moves, and
 * the release is the one thing that does not move.
 */

import { CliFailure } from '../domains/failure'
import { REPOSITORY } from '../runtime/version'

/** A release of the platform, and the images it published. */
export interface Release {
  /** The version of the platform the release holds. */
  readonly version: string
  /** The tag of the release. */
  readonly tag: string
  /** The images of the release, by the name of the value that names them. */
  readonly images: Readonly<Record<string, string>>
}

/** The services the release holds the images of. */
const SERVICES = ['gateway', 'access', 'data', 'console'] as const

/**
 * The tag of the latest release of the platform.
 *
 * The latest release is the one the platform published last, and it is
 * not a prerelease: a deployment that runs a prerelease runs code that
 * nobody proved.
 *
 * @param repository the repository the releases live in.
 */
export async function latestTagOf(repository: string = REPOSITORY): Promise<string> {
  const url = `https://api.github.com/repos/${repository}/releases/latest`
  let response: Response
  try {
    response = await fetch(url, { headers: { accept: 'application/vnd.github+json' } })
  } catch (error) {
    throw new CliFailure(
      `the latest release of the platform cannot be read: ${(error as Error).message}`,
      7,
      'unreachable'
    )
  }
  if (!response.ok) {
    throw new CliFailure(
      `the latest release of the platform is not there: the repository answered ${response.status}`,
      4,
      'not_found'
    )
  }
  let document: unknown
  try {
    document = await response.json()
  } catch {
    throw new CliFailure(
      'the latest release of the platform is not the answer the repository gives',
      8,
      'invalid_release'
    )
  }
  const tag = (document as { tag_name?: unknown }).tag_name
  if (typeof tag !== 'string' || tag === '') {
    throw new CliFailure('the latest release of the platform names no tag', 8, 'invalid_release')
  }
  return tag
}

/**
 * Reads the release of the platform.
 *
 * The file of the digests is the asset of the release: it names the
 * digest of every image, and it is the digest the gates of the release
 * proved.
 *
 * The version is the version of the platform, the tag of the release, or
 * `latest`: the latest release is a moving target, and the digests it
 * names are written into the values of the deployment, so the
 * deployment is pinned even when the release it names moves.
 *
 * @param version the version of the platform, or `latest`.
 * @param repository the repository the releases live in.
 */
export async function releaseOf(
  version: string,
  repository: string = REPOSITORY
): Promise<Release> {
  const tag = version === 'latest' ? await latestTagOf(repository) : `v${version.replace(/^v/, '')}`
  const url = `https://github.com/${repository}/releases/download/${tag}/digests.json`
  let response: Response
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } })
  } catch (error) {
    throw new CliFailure(
      `the release ${version} of the platform cannot be read: ${(error as Error).message}`,
      7,
      'unreachable'
    )
  }
  if (!response.ok) {
    throw new CliFailure(
      `the release ${version} of the platform is not there: ${url}`,
      4,
      'not_found'
    )
  }
  let document: unknown
  try {
    document = await response.json()
  } catch {
    throw new CliFailure(
      `the release ${version} of the platform does not hold its digests`,
      8,
      'invalid_release'
    )
  }
  if (!document || typeof document !== 'object') {
    throw new CliFailure(
      `the release ${version} of the platform does not hold its digests`,
      8,
      'invalid_release'
    )
  }
  const record = document as Record<string, unknown>
  const images = record.images
  if (!images || typeof images !== 'object') {
    throw new CliFailure(
      `the release ${version} of the platform does not hold its images`,
      8,
      'invalid_release'
    )
  }
  const held = images as Record<string, unknown>
  const found: Record<string, string> = {}
  for (const service of SERVICES) {
    const image = held[service]
    if (typeof image !== 'string' || !image.includes('@sha256:')) continue
    found[`${service}_image`] = image
  }
  return {
    version: typeof record.version === 'string' ? record.version : version,
    tag: typeof record.tag === 'string' ? record.tag : `v${version}`,
    images: found,
  }
}
