/**
 * The manifest of the baseline of the platform (docs/data/internals.md, Release acceptance).
 *
 * The manifest is the one place that owns the workspaces of the platform
 * and the revision that is tested against them. The harness, the
 * documentation and the check of the drift read it: a pin that is
 * written twice is a pin that will drift.
 *
 * The file is `compatibility.json`, at the root of the repository:
 *
 *   {
 *     "version": 2,
 *     "repository": "https://github.com/ggpwnkthx/platform.git",
 *     "workspaces": {
 *       "gateway": "packages/gateway",
 *       "access": "packages/access",
 *       "data": "packages/data"
 *     }
 *   }
 *
 * A workspace may also name the **source** it is pinned to:
 *
 *   {
 *     "workspaces": {
 *       "gateway": {
 *         "path": "packages/gateway",
 *         "source": {
 *           "repository": "https://github.com/ggpwnkthx/platform.git",
 *           "commit": "0123456789abcdef0123456789abcdef01234567"
 *         }
 *       }
 *     }
 *   }
 *
 * A workspace with a source is the **reference**: the suite clones the
 * source at the revision and it tests the candidate against it. A
 * workspace without a source is the candidate itself: the suite tests it
 * against the references that are pinned.
 *
 * Before the merge the manifest named two repositories and two commits:
 * the gateway was another repository, and Access was another
 * one. They are workspaces of this repository now, and the baseline is
 * the revision of the repository itself — the revision the platform was
 * released at, pinned in the manifest.
 *
 * The overrides of the environment are for the runs that test another
 * revision: they never change the manifest, and a run with an override
 * is not the proof of the baseline.
 */

/** The source a workspace is pinned to. */
export interface PinnedSource {
  /** The repository that holds the revision. */
  readonly repository: string
  /** The revision: forty hexadecimal characters, and never a branch. */
  readonly commit: string
}

/** A workspace of the baseline and the path of it. */
export interface PinnedWorkspace {
  /** The path of the workspace, relative to the root of the repository. */
  readonly path: string
  /** The source the workspace is pinned to, when it is a reference. */
  readonly source?: PinnedSource
}

/** The manifest of the baseline. */
export interface CompatibilityManifest {
  readonly version: 2
  /** The url of the repository of the platform. */
  readonly repository: string
  /** The workspaces of the platform, by name. */
  readonly workspaces: {
    readonly gateway: PinnedWorkspace
    readonly access: PinnedWorkspace
    readonly data: PinnedWorkspace
  }
}

/** The problem of a manifest that cannot be used. */
export class CompatibilityManifestError extends Error {
  override readonly name = 'CompatibilityManifestError'
}

/** The name of the file of the manifest. */
export const COMPATIBILITY_MANIFEST_FILE = 'compatibility.json'

/** The names of the workspaces of the platform. */
export const WORKSPACE_NAMES = ['gateway', 'access', 'data'] as const

/** Reports whether a value is a usable url or path. */
function isUsableUrl(value: string): boolean {
  return value.length > 0 && !/\s/.test(value)
}

/**
 * Parses and validates the manifest.
 *
 * The manifest is refused as a whole: a baseline that names a revision
 * that does not exist, or a branch instead of a revision, is not a
 * baseline.
 */
export function parseCompatibilityManifest(raw: string): CompatibilityManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CompatibilityManifestError('the manifest of the baseline is not json')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CompatibilityManifestError('the manifest of the baseline is not an object')
  }
  const file = parsed as Record<string, unknown>
  if (file.version !== 2) {
    throw new CompatibilityManifestError('the manifest of the baseline must have the version 2')
  }
  const unknownKeys = Object.keys(file).filter(
    (key) => key !== 'version' && key !== 'repository' && key !== 'workspaces'
  )
  if (unknownKeys.length > 0) {
    throw new CompatibilityManifestError(
      `the manifest of the baseline has unknown properties: ${unknownKeys.sort().join(', ')}`
    )
  }
  const repository = file.repository
  if (typeof repository !== 'string' || !isUsableUrl(repository)) {
    throw new CompatibilityManifestError('the manifest of the baseline must name the repository')
  }
  const workspaces = file.workspaces
  if (!workspaces || typeof workspaces !== 'object' || Array.isArray(workspaces)) {
    throw new CompatibilityManifestError(
      'the manifest of the baseline must hold the workspaces of the platform'
    )
  }
  const record = workspaces as Record<string, unknown>
  if (Object.keys(record).length === 0) {
    throw new CompatibilityManifestError(
      'the manifest of the baseline must hold the workspaces of the platform'
    )
  }
  const unknownWorkspaces = Object.keys(record).filter(
    (key) => !WORKSPACE_NAMES.includes(key as (typeof WORKSPACE_NAMES)[number])
  )
  if (unknownWorkspaces.length > 0) {
    throw new CompatibilityManifestError(
      `the manifest of the baseline has unknown workspaces: ${unknownWorkspaces.sort().join(', ')}`
    )
  }
  const parsedWorkspace = (name: string, raw: unknown): PinnedWorkspace => {
    // A workspace is a path, or a path and the source it is pinned to.
    if (typeof raw === 'string') {
      if (!isUsableUrl(raw)) {
        throw new CompatibilityManifestError(
          `the workspace "${name}" of the baseline must name a path`
        )
      }
      return { path: raw }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new CompatibilityManifestError(
        `the workspace "${name}" of the baseline must name a path`
      )
    }
    const workspace = raw as { path?: unknown; source?: unknown }
    const unknownKeys = Object.keys(workspace).filter((key) => key !== 'path' && key !== 'source')
    if (unknownKeys.length > 0) {
      throw new CompatibilityManifestError(
        `the workspace "${name}" of the baseline has unknown properties: ${unknownKeys.sort().join(', ')}`
      )
    }
    if (typeof workspace.path !== 'string' || !isUsableUrl(workspace.path)) {
      throw new CompatibilityManifestError(
        `the workspace "${name}" of the baseline must name a path`
      )
    }
    if (workspace.source === undefined) {
      return { path: workspace.path }
    }
    const source = workspace.source as { repository?: unknown; commit?: unknown }
    const unknownSourceKeys = Object.keys(source).filter(
      (key) => key !== 'repository' && key !== 'commit'
    )
    if (unknownSourceKeys.length > 0) {
      throw new CompatibilityManifestError(
        `the source of the workspace "${name}" of the baseline has unknown properties: ${unknownSourceKeys.sort().join(', ')}`
      )
    }
    if (typeof source.repository !== 'string' || !isUsableUrl(source.repository)) {
      throw new CompatibilityManifestError(
        `the source of the workspace "${name}" of the baseline must name a repository`
      )
    }
    if (typeof source.commit !== 'string' || !COMMIT_PATTERN.test(source.commit)) {
      throw new CompatibilityManifestError(
        `the source of the workspace "${name}" of the baseline must name a full revision of forty hexadecimal characters`
      )
    }
    return {
      path: workspace.path,
      source: { repository: source.repository, commit: source.commit },
    }
  }
  return {
    version: 2,
    repository,
    workspaces: {
      gateway: parsedWorkspace('gateway', record.gateway),
      access: parsedWorkspace('access', record.access),
      data: parsedWorkspace('data', record.data),
    },
  }
}

/** Reads the manifest of the baseline from the disk. */
export async function readCompatibilityManifest(
  path: string = COMPATIBILITY_MANIFEST_FILE
): Promise<CompatibilityManifest> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    throw new CompatibilityManifestError(`the manifest of the baseline is not there: ${path}`)
  }
  return parseCompatibilityManifest(await file.text())
}

/** The environment as a record of strings. */
export type Env = Record<string, string | undefined>

/**
 * The revision of a commit is forty hexadecimal characters.
 */
export const COMMIT_PATTERN = /^[0-9a-f]{40}$/

/**
 * The baseline of a run, and the overrides that were applied to it.
 *
 * A workspace of the platform is the reference of the suite by default.
 * The environment can name another revision: a repository and a commit
 * for each workspace. A run with an override is a run of a candidate,
 * and it is not the proof of the baseline of the manifest.
 */
export interface BaselineSelection {
  /** The workspaces of the platform and the revisions that are tested. */
  readonly workspaces: Record<string, { path: string; commit?: string; repository?: string }>
  /** The names of the variables that overrode the manifest. */
  readonly overrides: readonly string[]
  /** True when the run tests the revision of the checked in manifest. */
  readonly isBaseline: boolean
}

/**
 * Applies the overrides of the environment to the manifest.
 *
 * The precedence is the one of the manifest: the environment wins, and
 * an override that cannot be used stops the run. The manifest itself is
 * never changed.
 */
export function selectBaseline(
  manifest: CompatibilityManifest,
  env: Env = process.env
): BaselineSelection {
  const overrides: string[] = []
  const workspaces: BaselineSelection['workspaces'] = {}
  for (const name of WORKSPACE_NAMES) {
    const workspace = manifest.workspaces[name]
    const repositoryVariable = `${name.toUpperCase()}_REPOSITORY`
    const commitVariable = `${name.toUpperCase()}_COMMIT`
    const repository = env[repositoryVariable]
    const commit = env[commitVariable]
    if (repository !== undefined && repository !== '') {
      if (!isUsableUrl(repository)) {
        throw new CompatibilityManifestError(`${repositoryVariable} does not name a repository`)
      }
      overrides.push(repositoryVariable)
    }
    if (commit !== undefined && commit !== '') {
      if (!COMMIT_PATTERN.test(commit)) {
        throw new CompatibilityManifestError(
          `${commitVariable} must name a full revision of forty hexadecimal characters`
        )
      }
      overrides.push(commitVariable)
    }
    // The source of the manifest is the baseline. The environment wins
    // over it: a run with an override is a run of a candidate, and it is
    // not the proof of the baseline.
    const pinned = workspace.source
    workspaces[name] = {
      path: workspace.path,
      ...(pinned ? { repository: pinned.repository } : {}),
      ...(pinned ? { commit: pinned.commit } : {}),
      ...(repository ? { repository } : {}),
      ...(commit ? { commit } : {}),
    }
  }
  return { workspaces, overrides, isBaseline: overrides.length === 0 }
}
