/**
 * The one repository of the platform.
 *
 * The platform is one repository, and it names one: the one it lives
 * in, the three images it publishes, and the mirrors of the
 * compatibility suite. The three services were published from three
 * repositories of their own, and those repositories are gone: a clone
 * of one fails, an image published in one is not reachable, a release
 * published in one is not there — and a document that sends an operator
 * to one sends it to a dead end.
 *
 * The check does not name the repositories that are gone. It refuses
 * every repository but the one of the platform: a name that the
 * platform does not own is a dead end, whatever it is, and a list of
 * dead ends is a list that has to be maintained — and one that names
 * them again. The record of what was is not kept either: the version
 * lines the retired repositories carried are not continued, and a
 * version that is not continued is not a version.
 */

/** The owner of the repository of the platform. */
export const PLATFORM_OWNER = 'ggpwnkthx'

/** The name of the repository of the platform. */
export const PLATFORM_REPOSITORY = 'platform'

/** The names of the images of the platform. */
export const PLATFORM_IMAGES: readonly string[] = ['gateway', 'access', 'data']

/** Every name the platform owns: the repository, and the images. */
export const PLATFORM_NAMES: readonly string[] = [PLATFORM_REPOSITORY, ...PLATFORM_IMAGES]

/**
 * The way a reference names a repository.
 *
 * The kind says what the reference is: a clone of a repository, an
 * image of a registry, a bare mirror of a repository, or the name of
 * one in a sentence.
 */
export type ReferenceKind = 'repository' | 'image' | 'mirror' | 'name'

/** A reference to a repository that the platform does not have. */
export interface RepositoryReference {
  /** The line the reference is on, counted from one. */
  readonly line: number
  /** The name the reference names. */
  readonly name: string
  /** What the reference is. */
  readonly kind: ReferenceKind
}

/** A url of a repository of the owner: a clone, or the page of it. */
const REPOSITORY_URL = new RegExp(`github\\.com[:/]${PLATFORM_OWNER}/([A-Za-z0-9._-]+)`, 'g')

/** An image of the registry of the owner. */
const IMAGE_URL = new RegExp(`ghcr\\.io/${PLATFORM_OWNER}/([A-Za-z0-9._-]+)`, 'g')

/** The name of a repository of the owner, in any sentence. */
const OWNER_NAME = new RegExp(`${PLATFORM_OWNER}/([A-Za-z0-9._-]+)`, 'g')

/** The name of a bare mirror of a repository. */
const MIRROR_NAME = /([A-Za-z0-9._-]+)\.git\b/g

/**
 * Reports whether a name is one of the names of the platform.
 *
 * The repository of the platform is one, and the images are three: a
 * name that is not one of them is a name of something else, and
 * something else is a dead end.
 */
export function isNameOfThePlatform(name: string): boolean {
  return PLATFORM_NAMES.includes(name)
}

/**
 * Reports the references to a repository the platform does not have.
 *
 * The lines are the ones of the content: a file that names a
 * repository is reported with the line that names it, and not with the
 * file alone. A reference that names the repository of the platform, or
 * one of its images, is not a reference to a dead end: it is not
 * reported.
 */
export function repositoryReferencesOf(content: string): RepositoryReference[] {
  const references: RepositoryReference[] = []
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    // The kinds are looked at in the order of what they are: a url of
    // a repository says more than the name of one, and the first one
    // that names a repository is the one that is reported.
    const found = new Map<string, ReferenceKind>()
    const record = (name: string, kind: ReferenceKind): void => {
      const plain = name.replace(/\.git$/, '')
      if (plain.length === 0) return
      if (!found.has(plain)) found.set(plain, kind)
    }
    for (const match of line.matchAll(REPOSITORY_URL)) record(match[1]!, 'repository')
    for (const match of line.matchAll(IMAGE_URL)) record(match[1]!, 'image')
    for (const match of line.matchAll(MIRROR_NAME)) record(match[1]!, 'mirror')
    for (const match of line.matchAll(OWNER_NAME)) record(match[1]!, 'name')
    for (const [name, kind] of found) {
      // The repository of the platform is the only repository: a clone
      // of anything else is a clone of a dead end.
      if (kind === 'repository' && name === PLATFORM_REPOSITORY) continue
      // The registry of the owner holds the three images, and nothing
      // else: an image of a name that is not one of them is an image
      // that was never published.
      if (kind === 'image' && PLATFORM_IMAGES.includes(name)) continue
      // A mirror and a name in a sentence may name the repository or
      // one of the images: the role of the service is the name of its
      // mirror and of its workspace.
      if (kind !== 'repository' && kind !== 'image' && isNameOfThePlatform(name)) continue
      references.push({ line: index + 1, name, kind })
    }
  }
  return references
}
