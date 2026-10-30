/**
 * The digests of a registry.
 *
 * The images of the platform come from the release, and the release
 * names their digests. The image of the client of PostgreSQL is the one
 * image of a deployment that the platform does not publish: it is an
 * image of a registry of somebody else, and the wizard reads its digest
 * from that registry the way it reads the digests of the release.
 */

import { CliFailure } from '../domains/failure'

/** The registry of the images of Docker Hub. */
const REGISTRY = 'registry-1.docker.io'

/** The service that answers with the token of the registry. */
const AUTH = 'auth.docker.io'

/** The shapes of a manifest the registry may answer with. */
const MANIFESTS = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

/**
 * The tag of an image of a registry, as the reference names it.
 *
 * The reference of an image names the tag between the name of the image
 * and the digest: `postgres:18-alpine@sha256:…` names the tag
 * `18-alpine`.
 *
 * @param reference the reference of the image.
 */
export function tagOf(reference: string): string | undefined {
  const withoutDigest = reference.split('@')[0] ?? ''
  const colon = withoutDigest.lastIndexOf(':')
  if (colon < 0) return undefined
  const tag = withoutDigest.slice(colon + 1)
  if (tag === '' || tag.includes('/')) return undefined
  return tag
}

/**
 * The digest of the image a tag names.
 *
 * The registry answers with the digest in a header, and it asks for a
 * token first: the token is asked of the service of the registry, and
 * it carries the right to pull the image and nothing else.
 *
 * @param repository the repository of the image, for example `library/postgres`.
 * @param tag the tag of the image.
 */
export async function digestOf(repository: string, tag: string): Promise<string> {
  const token = await tokenOf(repository)
  let response: Response
  try {
    response = await fetch(`https://${REGISTRY}/v2/${repository}/manifests/${tag}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: MANIFESTS,
      },
    })
  } catch (error) {
    throw new CliFailure(
      `the digest of ${repository}:${tag} cannot be read: ${(error as Error).message}`,
      7,
      'unreachable'
    )
  }
  if (!response.ok) {
    throw new CliFailure(
      `the digest of ${repository}:${tag} is not there: the registry answered ${response.status}`,
      4,
      'not_found'
    )
  }
  const digest = response.headers.get('docker-content-digest')
  if (!digest || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new CliFailure(`the digest of ${repository}:${tag} is not a digest`, 8, 'invalid_digest')
  }
  return digest
}

/**
 * The token that opens the pull of an image.
 *
 * @param repository the repository of the image.
 */
async function tokenOf(repository: string): Promise<string> {
  const url = `https://${AUTH}/token?service=registry.docker.io&scope=repository:${repository}:pull`
  let response: Response
  try {
    response = await fetch(url)
  } catch (error) {
    throw new CliFailure(
      `the registry of the images cannot be reached: ${(error as Error).message}`,
      7,
      'unreachable'
    )
  }
  if (!response.ok) {
    throw new CliFailure(
      `the registry of the images answered ${response.status} to the token`,
      7,
      'unreachable'
    )
  }
  const document = (await response.json()) as { token?: unknown }
  if (typeof document.token !== 'string' || document.token === '') {
    throw new CliFailure('the registry of the images did not answer a token', 8, 'invalid_answer')
  }
  return document.token
}
