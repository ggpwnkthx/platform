#!/usr/bin/env bun
/**
 * The compatibility runner of Access.
 *
 * The compatibility suite runs the **real** gateway of the platform,
 * unchanged, against access. The gateway is a reference: it
 * is the workspace `packages/gateway/` of this repository, and it is never
 * modified.
 *
 * Before the merge the reference was a checkout of another repository,
 * at a commit that was pinned in `compatibility.json`. The gateway is a
 * workspace of this repository now, and the baseline is the revision of
 * the repository itself.
 *
 * This script is the one that prepares the reference and runs the suite.
 * It is used by the continuous integration and by a developer, and both
 * read the same manifest: the file `compatibility.json` at the root of
 * the repository.
 *
 *   bun run test:compatibility
 *
 * The environment:
 *
 *   ACCESS_GATEWAY_PATH     the directory of the gateway that is already
 *                         prepared: it is used as it is, and it is checked
 *                         before the run (its tracked files have to be the
 *                         ones of the revision that is tested).
 *   GATEWAY_REPOSITORY   the repository of the gateway: a git url or the
 *                         path of a local repository. It has to hold the
 *                         revision of GATEWAY_COMMIT.
 *   GATEWAY_COMMIT       the revision of the gateway. Without it, the
 *                         head of the repository is the revision.
 *   COMPAT_MIRROR        a directory that holds a bare repository named
 *                         `gateway.git`. It is the way to run the suite
 *                         without the network.
 *   COMPAT_WORKSPACE     the directory the checkout is created in. It is
 *                         a temporary directory by default.
 *   COMPAT_KEEP          when it is set, the checkout is kept: the suite
 *                         is then inspected after the run.
 *
 * The order of the sources is the one of the list above: the first one
 * that is set wins. An override that is set and that does not hold the
 * revision is an error: the suite never falls back to another source,
 * because a suite that runs against another revision is a suite that
 * proves nothing.
 */

import { spawn, spawnSync, type Subprocess } from 'bun'
import { existsSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  cloneAt,
  install,
  repositoryOf,
  sourceForCommit,
  trackedChanges,
  useWorkspace,
} from '../../../../tooling/compatibility/reference'

/** The name of the manifest of the references. */
export const MANIFEST_NAME = 'compatibility.json'

/** The name of the workspace of the gateway, in the manifest. */
export const REFERENCE_NAME = 'gateway'

/** The source a reference is pinned to. */
export interface PinnedSource {
  /** The repository that holds the revision. */
  repository: string
  /** The commit of the reference: it is immutable. */
  commit: string
}

/** The workspace of the reference: its path, and the source it is pinned to. */
export interface ReferenceWorkspace {
  /** The path of the workspace, relative to the root of the platform. */
  path: string
  /** The source the reference is pinned to, when it is a published revision. */
  source?: PinnedSource
}

/** The manifest of the references. */
export interface CompatibilityManifest {
  /** The version of the format of the manifest. */
  version: number
  /** The workspace of the reference. */
  workspace: ReferenceWorkspace
}

/** A source of the reference, and where it comes from. */
export interface ResolvedSource {
  /** The kind of the source. */
  kind: 'workspace' | 'prepared' | 'repository'
  /** The path of the checkout, for a prepared checkout or a workspace. */
  path?: string
  /** The url or the path of the repository to clone. */
  repository?: string
  /** The commit to check out, for a repository. */
  commit?: string
  /** The name of the source, for the logs. */
  origin: string
}

/** The options of a run of the suite. */
export interface RunnerOptions {
  /** The root of this workspace: the directory that holds the sources. */
  root: string
  /** The root of the platform: the directory that holds the manifest. */
  platformRoot: string
  /** The environment of the run. */
  env: Record<string, string | undefined>
  /** The directory the checkout is created in. */
  workspace?: string
  /** The command that runs the suite. */
  command?: string[]
  /** The logger of the run. */
  log?: (message: string) => void
}

/** The result of a run of the suite. */
export interface RunnerResult {
  /** The status of the suite: it is the status of the test process. */
  status: number
  /** The revision of the reference that was tested. */
  commit: string
  /** The source the reference came from. */
  origin: string
  /** The path of the checkout that was tested. */
  checkout: string
  /** True when the checkout belongs to the runner and is cleaned up. */
  owned: boolean
}

/** The default command of the suite. */
export const DEFAULT_COMMAND = ['bun', 'test', 'test/compatibility']

/**
 * The command of the suite, from the environment.
 *
 * `COMPAT_TESTS` names the test files of the suite: a list of paths,
 * separated by spaces, relative to the root of this workspace. It is
 * empty by default, and the suite is then the whole of
 * `test/compatibility`.
 */
export function commandFromEnv(env: Record<string, string | undefined>): string[] {
  const tests = env.COMPAT_TESTS?.trim()
  if (!tests) return DEFAULT_COMMAND
  const files = tests.split(/\s+/).filter((file) => file.length > 0)
  if (files.length === 0) return DEFAULT_COMMAND
  return ['bun', 'test', ...files]
}

/** The process of the suite, when it runs: it is killed on a signal. */
let runningChild: Subprocess | null = null

/**
 * Reads the manifest of the references.
 *
 * The manifest is read relatively to the root of the platform: the
 * caller may run the script from anywhere.
 */
export async function readManifest(root: string): Promise<CompatibilityManifest> {
  const path = join(root, MANIFEST_NAME)
  let content: string
  try {
    content = await Bun.file(path).text()
  } catch {
    throw new Error(`the manifest of the references is not there: ${path}`)
  }
  return parseManifest(content)
}

/**
 * Parses the manifest of the references.
 *
 * The format is checked: a manifest that names a branch, a tag or a
 * placeholder is not a pin, and a pin that is not immutable cannot be
 * tested.
 */
export function parseManifest(content: string): CompatibilityManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new Error(`the manifest of the references is not a json document: ${String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('the manifest of the references is not an object')
  }
  const manifest = parsed as {
    version?: unknown
    repository?: unknown
    workspaces?: Record<string, unknown>
  }
  if (manifest.version !== 2) {
    throw new Error(
      `the manifest of the references has the version ${String(manifest.version)} and not 2`
    )
  }
  if (typeof manifest.repository !== 'string' || manifest.repository.length === 0) {
    throw new Error('the manifest of the references holds no repository')
  }
  if (typeof manifest.workspaces !== 'object' || manifest.workspaces === null) {
    throw new Error('the manifest of the references holds no workspaces')
  }
  const raw = manifest.workspaces[REFERENCE_NAME]
  if (typeof raw === 'string') {
    if (raw.length === 0) {
      throw new Error(`the manifest of the references holds no workspace named "${REFERENCE_NAME}"`)
    }
    return { version: 2, workspace: { path: raw } }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`the manifest of the references holds no workspace named "${REFERENCE_NAME}"`)
  }
  const workspace = raw as { path?: unknown; source?: unknown }
  if (typeof workspace.path !== 'string' || workspace.path.length === 0) {
    throw new Error(`the manifest of the references holds no workspace named "${REFERENCE_NAME}"`)
  }
  if (workspace.source === undefined) {
    return { version: 2, workspace: { path: workspace.path } }
  }
  const source = workspace.source as { repository?: unknown; commit?: unknown }
  if (typeof source.repository !== 'string' || source.repository.length === 0) {
    throw new Error(
      `the source of the workspace "${REFERENCE_NAME}" of the manifest names no repository`
    )
  }
  if (typeof source.commit !== 'string' || !/^[0-9a-f]{40}$/.test(source.commit)) {
    throw new Error(
      `the source of the workspace "${REFERENCE_NAME}" of the manifest must name a full revision of forty hexadecimal characters`
    )
  }
  return {
    version: 2,
    workspace: {
      path: workspace.path,
      source: { repository: source.repository, commit: source.commit },
    },
  }
}

/**
 * Resolves the source of the reference.
 *
 * The order of the sources is the one of the environment: an explicit
 * directory, then an explicit repository, then a mirror, and then the
 * workspace of this repository. A source that is set and that cannot be
 * used is an error: the suite never falls back to another source.
 */
export function resolveSource(
  env: Record<string, string | undefined>,
  manifest: CompatibilityManifest,
  platformRoot = resolve(import.meta.dir, '..', '..', '..', '..')
): ResolvedSource {
  const prepared = env.ACCESS_GATEWAY_PATH
  if (prepared) {
    const path = resolve(prepared)
    if (!existsSync(path)) {
      throw new Error(`ACCESS_GATEWAY_PATH names a directory that is not there: ${path}`)
    }
    return { kind: 'prepared', path, origin: `ACCESS_GATEWAY_PATH (${path})` }
  }

  const repository = env.GATEWAY_REPOSITORY
  if (repository) {
    return {
      kind: 'repository',
      repository,
      ...(env.GATEWAY_COMMIT ? { commit: env.GATEWAY_COMMIT } : {}),
      origin: `GATEWAY_REPOSITORY (${repository})`,
    }
  }

  const mirror = env.COMPAT_MIRROR
  if (mirror) {
    const path = join(resolve(mirror), `${REFERENCE_NAME}.git`)
    if (!existsSync(path)) {
      throw new Error(
        `COMPAT_MIRROR names a directory that holds no bare repository named "${REFERENCE_NAME}.git": ${path}`
      )
    }
    return { kind: 'repository', repository: path, origin: `COMPAT_MIRROR (${path})` }
  }

  const workspace = manifest.workspace.path
  const pinned = manifest.workspace.source
  if (pinned) {
    // The baseline of the manifest: the revision the candidate is tested
    // against. The local repository is preferred when it holds the
    // revision: a runner that has the revision does not need the network.
    const source = sourceForCommit(
      pinned.repository,
      pinned.commit,
      env.COMPAT_MIRROR ?? '',
      platformRoot
    )
    return {
      kind: 'repository',
      repository: source,
      commit: pinned.commit,
      origin: `the baseline of the manifest (${pinned.repository} at ${pinned.commit})`,
    }
  }
  const path = resolve(platformRoot, workspace)
  return { kind: 'workspace', path, origin: `the workspace ${workspace} of this repository` }
}

/** Runs a command and returns its status and its output. */
function run(
  command: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {}
): { status: number; output: string } {
  const result = spawnSync(command, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const output = `${result.stdout?.toString() ?? ''}${result.stderr?.toString() ?? ''}`
  return { status: result.exitCode ?? 1, output }
}

/** The commit of the HEAD of a checkout. */
export function headOf(directory: string): string {
  const result = run(['git', 'rev-parse', 'HEAD'], { cwd: directory })
  if (result.status !== 0) {
    throw new Error(`${directory} is not a git checkout: ${result.output.trim()}`)
  }
  return result.output.trim()
}

/**
 * Checks a checkout that a developer prepared.
 *
 * The checkout is read, never written: a checkout that carries changes is
 * refused. The suite that runs against another revision proves nothing,
 * and a checkout that is modified by the runner is a checkout the
 * developer did not ask for.
 */
export function checkPreparedCheckout(directory: string): void {
  const repository = repositoryOf(directory)
  const changes = trackedChanges(repository, directory)
  if (changes.length > 0) {
    throw new Error(
      `the prepared checkout ${directory} carries changes to its tracked files:\n${changes}\n` +
        'the reference is read-only: the checkout has to be the one of the revision that is tested'
    )
  }
}

/**
 * Clones a repository and checks out the pinned commit.
 *
 * The whole history is cloned: the pinned commit is not always the one
 * of the default branch, and the default branch of a source is not the
 * business of the runner.
 */
export { cloneAt }

/**
 * Runs the suite and waits for it.
 *
 * The process is killed when the runner is interrupted: a gateway that
 * outlives the run is a process that holds a port.
 */
export async function runSuite(
  root: string,
  checkout: string,
  command: string[],
  env: Record<string, string | undefined>
): Promise<number> {
  const child: Subprocess = spawn(command, {
    cwd: root,
    env: {
      ...process.env,
      ...env,
      // The path of the reference is the one the suite reads: the suite
      // never looks for a sibling directory.
      ACCESS_GATEWAY_PATH: checkout,
    },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  runningChild = child
  try {
    const code = await child.exited
    // A process that was killed by a signal has no status: it is a
    // failure, and a failure that is not a success.
    return typeof code === 'number' ? code : 1
  } finally {
    runningChild = null
  }
}

/**
 * Runs the compatibility suite against the reference.
 *
 * The function throws when the reference cannot be prepared, and it
 * returns the status of the suite when the suite ran: a failure of the
 * suite is the status of the suite, not an exception.
 */
export async function runCompatibility(options: RunnerOptions): Promise<RunnerResult> {
  const log = options.log ?? ((message: string) => console.log(message))
  const manifest = await readManifest(options.platformRoot)
  const source = resolveSource(options.env, manifest, options.platformRoot)

  let checkout: string
  let cloneRoot: string | undefined
  let owned = false
  let workspace: string | undefined
  let workspaceOwned = false
  let revision: string

  if (source.kind === 'workspace' || source.kind === 'prepared') {
    checkout = source.path!
    checkPreparedCheckout(checkout)
    const reference = useWorkspace(checkout)
    revision = reference.revision
    log(`the reference is the workspace ${checkout} at ${revision}`)
  } else {
    if (options.workspace) {
      workspace = options.workspace
      await mkdir(workspace, { recursive: true })
    } else {
      workspace = await mkdtemp(join(tmpdir(), 'access-compatibility-'))
      workspaceOwned = true
    }
    const cloneRootPath = join(workspace, REFERENCE_NAME)
    const commit = source.commit ?? headOf(source.repository!)
    log(`the reference is cloned from ${source.origin} at ${commit}`)
    cloneAt(source.repository!, commit, cloneRootPath)
    // The clone holds the whole repository: the gateway is the workspace
    // of it, at the path the manifest names, and the dependencies of the
    // repository are installed at its root.
    install(cloneRootPath)
    cloneRoot = cloneRootPath
    checkout = join(cloneRootPath, manifest.workspace.path)
    revision = commit
    owned = true
  }

  const cleanup = async (): Promise<void> => {
    // A checkout of a developer is never removed: the runner only
    // removes what it owns.
    if (!owned || !workspace) return
    if (options.env.COMPAT_KEEP) {
      log(`the checkout is kept: ${checkout}`)
      return
    }
    await rm(cloneRoot ?? checkout, { recursive: true, force: true })
    if (workspaceOwned) {
      await rm(workspace, { recursive: true, force: true })
    }
  }

  // An interruption removes the checkout of the runner and stops the
  // suite: a temporary directory that is left behind is a directory
  // nobody looks at again, and a gateway that outlives the run is a
  // process that holds a port.
  const interrupted = (): void => {
    try {
      runningChild?.kill('SIGTERM')
    } catch {
      // The process is already gone.
    }
    if (owned && workspace && !options.env.COMPAT_KEEP) {
      rmSync(workspace, { recursive: true, force: true })
    }
    process.exit(130)
  }
  process.on('SIGINT', interrupted)
  process.on('SIGTERM', interrupted)

  try {
    const status = await runSuite(
      options.root,
      checkout,
      options.command ?? DEFAULT_COMMAND,
      options.env
    )

    const changes = trackedChanges(repositoryOf(checkout), checkout)
    if (changes.length > 0) {
      throw new Error(`the reference carries changes to its tracked files:\n${changes}`)
    }
    log(`the reference is unchanged: it is still ${revision}`)

    return { status, commit: revision, origin: source.origin, checkout, owned }
  } finally {
    process.off('SIGINT', interrupted)
    process.off('SIGTERM', interrupted)
    await cleanup()
  }
}

/** The main of the runner. */
export async function main(): Promise<number> {
  const root = resolve(import.meta.dir, '..', '..')
  const platformRoot = resolve(root, '..', '..')
  const workspace = process.env.COMPAT_WORKSPACE
  try {
    const result = await runCompatibility({
      root,
      platformRoot,
      env: process.env,
      command: commandFromEnv(process.env),
      ...(workspace ? { workspace } : {}),
    })
    if (result.status !== 0) {
      console.error(`the compatibility suite failed with the status ${result.status}`)
      return result.status
    }
    console.log(
      `the compatibility suite passed against the gateway at ${result.commit} (${result.origin})`
    )
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (import.meta.main) {
  process.exit(await main())
}
