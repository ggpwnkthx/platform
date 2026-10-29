/**
 * The acquisition of the references of the compatibility suite.
 *
 * The references of the suite are the workspaces of this repository:
 * the gateway of `packages/gateway/`, Access of
 * `packages/access/` and Data of `packages/data/`. They are
 * not cloned: they are the code of this repository, and the suite proves
 * that the tracked files of the workspaces are the ones of the revision
 * that is tested.
 *
 * A run may name another revision: the environment can point a
 * workspace at a repository and a commit, and the reference is then
 * cloned at that revision. It is the way to test a **published**
 * revision of a service against the rest of the platform.
 */

import { spawnSync } from 'bun'
import { existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/** The result of a git command. */
export interface GitResult {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

/** Runs a git command and captures its output. */
export function git(args: string[], cwd?: string): GitResult {
  const result = spawnSync(['git', ...args], { cwd })
  return {
    status: result.exitCode ?? 1,
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
  }
}

/** A reference of the suite: a directory and the revision it holds. */
export interface Reference {
  /** The directory of the reference. */
  readonly path: string
  /** The revision of the repository that holds it. */
  readonly revision: string
  /** True when the reference is a workspace of this repository. */
  readonly workspace: boolean
}

/**
 * The root of the git repository that holds a directory.
 *
 * A directory that is not in a repository is not a reference: the suite
 * has to know the revision it tests.
 */
export function repositoryOf(directory: string): string {
  const result = git(['rev-parse', '--show-toplevel'], directory)
  if (result.status !== 0) {
    throw new Error(
      `${directory} is not in a git repository: the reference of the suite has to be in one`
    )
  }
  return result.stdout.trim()
}

/** The revision of the head of a repository. */
export function revisionOf(repository: string): string {
  const result = git(['rev-parse', 'HEAD'], repository)
  if (result.status !== 0) {
    throw new Error(`the revision of ${repository} could not be read: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

/**
 * The tracked changes of a directory of a repository.
 *
 * The untracked files are not reported: the dependencies of a reference
 * are installed in it, and they are not tracked.
 */
export function trackedChanges(repository: string, directory: string): string {
  const relativePath = relative(repository, directory).split('\\').join('/')
  // The directory is the repository itself: the pathspec of the whole
  // tree is a dot, and an empty one is an error of git.
  const path = relativePath.length > 0 ? relativePath : '.'
  const result = git(['status', '--porcelain', '--untracked-files=no', '--', path], repository)
  if (result.status !== 0) {
    throw new Error(`the state of ${directory} could not be read: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

/**
 * The reference of a workspace of this repository.
 *
 * The workspace is used as it is, and it is checked: the tracked files
 * of it have to be the ones of the revision of the repository. A
 * workspace that carries changes is not the revision that is tested,
 * and the suite says so instead of testing something else.
 */
export function useWorkspace(directory: string): Reference {
  const path = resolve(directory)
  if (!existsSync(path)) {
    throw new Error(`the workspace of the reference is not there: ${path}`)
  }
  const repository = repositoryOf(path)
  const changes = trackedChanges(repository, path)
  if (changes.length > 0) {
    throw new Error(
      `the workspace ${path} carries changes to its tracked files:\n${changes}\n` +
        'the reference is read-only: the workspace has to be the one of the revision that is tested'
    )
  }
  return { path, revision: revisionOf(repository), workspace: true }
}

/**
 * Clones a repository at a revision and proves that the clone is the
 * revision.
 *
 * The whole history is cloned: the pinned commit is not always the one
 * of the default branch, and the default branch of a source is not the
 * business of the runner.
 */
export function cloneAt(repository: string, commit: string, directory: string): void {
  const clone = git(['clone', '--quiet', repository, directory])
  if (clone.status !== 0) {
    throw new Error(
      `the clone of ${repository} failed: ${clone.stderr.trim()}. ` +
        'Set the repository of the environment to a local checkout that holds the revision, ' +
        'or point the mirror of the harness at the bare mirrors.'
    )
  }
  const known = git(['cat-file', '-e', `${commit}^{commit}`], directory)
  if (known.status !== 0) {
    // The commit is not reachable from the branches that were cloned: it
    // is asked for by its identifier.
    const fetch = git(['fetch', '--quiet', 'origin', commit], directory)
    if (fetch.status !== 0) {
      throw new Error(
        `the source ${repository} does not hold the pinned commit ${commit}\n` +
          'the pin has to be a commit of the source'
      )
    }
  }
  const checkout = git(['checkout', '--quiet', '--detach', commit], directory)
  if (checkout.status !== 0) {
    throw new Error(
      `the checkout of ${commit} failed: ${checkout.stderr.trim()}\n` +
        `the source ${repository} does not hold the pinned commit`
    )
  }
  const head = revisionOf(directory)
  if (head !== commit) {
    throw new Error(
      `the clone of ${repository} is at ${head || 'an unknown revision'} and the baseline is ${commit}`
    )
  }
}

/**
 * The source of a clone.
 *
 * A repository that is a path on the disk is used as it is: the clone of
 * a local path does not use the network. When the path is not there, the
 * mirror of the harness is used, if it holds the repository. The url is
 * the last resort.
 */
export function sourceOf(repository: string, mirrorDirectory: string): string {
  if (existsSync(repository)) return repository
  if (mirrorDirectory) {
    const mirror = join(mirrorDirectory, `${mirrorName(repository)}.git`)
    if (existsSync(mirror)) return mirror
  }
  return repository
}

/**
 * The name of the mirror of a repository.
 *
 * The url of a repository and the name of its mirror are the same thing
 * with or without the suffix `.git`.
 */
export function mirrorName(url: string): string {
  const withoutSuffix = url.endsWith('.git') ? url.slice(0, '.git'.length) : url
  const segments = withoutSuffix.replace(/\/+$/, '').split(/[/\\]/)
  return segments[segments.length - 1] ?? ''
}

/**
 * Reports whether a repository holds a revision.
 *
 * The revision is asked for by its identifier, and the answer is the
 * answer of git: a repository that does not hold it cannot be cloned at
 * it.
 */
export function holdsCommit(repository: string, commit: string): boolean {
  const result = git(['cat-file', '-e', `${commit}^{commit}`], repository)
  return result.status === 0
}

/**
 * The source of the clone of a pinned revision.
 *
 * The repository of a pin is a url, and the url of a repository that is
 * not published is a url that cannot be cloned. The local repository is
 * used when it holds the pinned revision: the runner has the revision
 * in front of it, and a runner that has the revision does not need the
 * network to test it.
 *
 * The order of the sources is the one of the list: the path itself, the
 * local repository, the mirror of the harness and the url. The mirror
 * wins over the url, because a mirror is a mirror of the url and it
 * holds the revision when the url holds it.
 */
export function sourceForCommit(
  repository: string,
  commit: string,
  mirrorDirectory: string,
  localRepository?: string
): string {
  if (existsSync(repository)) return repository
  const local = localRepository ?? repositoryOf(process.cwd())
  if (holdsCommit(local, commit)) return local
  if (mirrorDirectory) {
    const mirror = join(mirrorDirectory, `${mirrorName(repository)}.git`)
    if (existsSync(mirror) && holdsCommit(mirror, commit)) return mirror
  }
  return repository
}

/** Installs the dependencies of a reference, in the reference itself. */
export function install(directory: string): void {
  const result = spawnSync(['bun', 'install', '--frozen-lockfile'], { cwd: directory })
  if (result.exitCode !== 0) {
    throw new Error(`the installation of the reference failed: ${result.stderr?.toString() ?? ''}`)
  }
}
