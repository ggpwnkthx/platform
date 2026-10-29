#!/usr/bin/env bun
/**
 * The version of the release of Access.
 *
 * The version of the release is written in several places: the package
 * of the workspace, the image, the answer of the probe of the health,
 * the status of the specification and the state of the release in the
 * documentation. They have to name the same release, because an image
 * that carries another version deploys something else than the one that
 * was released.
 *
 * The status of the specification is the release that carries it: the
 * specification describes the behaviour of the release it names, and a
 * specification that names another one describes a behaviour the code
 * does not have.
 *
 * This script checks them. It runs in the test suite and in the
 * continuous integration, so a drift fails the build instead of
 * shipping.
 *
 * The version of the platform is checked across the three workspaces by
 * the script of the root of the repository: `scripts/version.ts`.
 */

import {
  checkVersionConsistency as checkConsistency,
  readPackageVersion,
  readSources,
  type VersionFinding,
  type VersionSource,
} from '../../../../tooling/version'

/**
 * The files that hold the version of the release, and how to read them.
 *
 * The version of the package is the reference: it is the one the
 * release workflow reads and the one the tag of the release carries.
 */
export const VERSION_SOURCES: readonly VersionSource[] = [
  {
    path: 'package.json',
    read: (content) => {
      try {
        const parsed = JSON.parse(content) as { version?: unknown }
        return typeof parsed.version === 'string' ? parsed.version : null
      } catch {
        return null
      }
    },
  },
  {
    path: 'Dockerfile',
    read: (content) => /^ARG VERSION=(.+)$/m.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'src/runtime/version.ts',
    read: (content) => /export const VERSION = '(.+)'/.exec(content)?.[1]?.trim() ?? null,
  },
]

/**
 * The files that hold the status of the specification and the state of
 * the release in the documentation.
 *
 * The status of the specification is the release that carries it, and
 * the state of the release in the documentation says the same.
 */
export const RELEASE_STATE_SOURCES: readonly VersionSource[] = [
  {
    path: '../../docs/access/spec.md',
    read: (content) => /^Status:\s*(\d+\.\d+\.\d+)/m.exec(content)?.[1] ?? null,
  },
  {
    path: '../../docs/access/README.md',
    // The state of the release: the version it is at.
    read: (content) => /^Version `(\d+\.\d+\.\d+)`/m.exec(content)?.[1] ?? null,
  },
]

/** Checks that the files hold the same version. */
export function checkVersionConsistency(files: Record<string, string>): VersionFinding[] {
  return checkConsistency(files, [...VERSION_SOURCES, ...RELEASE_STATE_SOURCES])
}

/** Reads the files of the tree and checks that they agree. */
export async function checkVersions(root: string): Promise<VersionFinding[]> {
  const files = await readSources(root, [...VERSION_SOURCES, ...RELEASE_STATE_SOURCES])
  return checkConsistency(files, [...VERSION_SOURCES, ...RELEASE_STATE_SOURCES])
}

export { readPackageVersion }

if (import.meta.main) {
  const root = process.cwd()
  const findings = await checkVersions(root)
  if (findings.length === 0) {
    console.log('the version of the release is the same everywhere')
    process.exit(0)
  }
  for (const finding of findings) {
    console.error(`${finding.file}: ${finding.message}`)
  }
  console.error('the version of the release is not the same everywhere')
  process.exit(1)
}
