#!/usr/bin/env bun
/**
 * The version of the platform.
 *
 * The platform has one version line. The three services were three
 * repositories, and each of them carried a version of its own; the
 * repositories are retired, and the lines they carried are not
 * continued here. What is left is one number: the version of the
 * repository, of the tag, of the three images and of the three
 * binaries. Every file that names it has to name the same one: a
 * manifest that points at an image of another version deploys
 * something else than the one that was released, and a specification
 * that describes another release describes a behaviour the code does
 * not have.
 *
 * This script checks it. It runs in the test suite and in the
 * continuous integration, so a drift fails the build instead of
 * shipping.
 *
 *   bun run versions
 */

import {
  checkVersionConsistency as checkConsistency,
  readPackageVersion,
  readSources,
  RELEASE_VERSION,
  type VersionFinding,
  type VersionSource,
} from '../tooling/version'

/**
 * The files that hold the version of the platform, and how to read them.
 *
 * The version of the package of the root is the reference: it is the one
 * the workflow of the release reads and the one the tag carries.
 */
export const PLATFORM_VERSION_SOURCES: readonly VersionSource[] = [
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
    path: 'packages/gateway/package.json',
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
    path: 'packages/access/package.json',
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
    path: 'packages/data/package.json',
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
    path: 'packages/data/packages/client/package.json',
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
    path: 'packages/console/package.json',
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
    path: 'packages/gateway/Dockerfile',
    read: (content) => /^ARG VERSION=(.+)$/m.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'packages/access/Dockerfile',
    read: (content) => /^ARG VERSION=(.+)$/m.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'packages/data/Dockerfile',
    read: (content) => /^ARG VERSION=(.+)$/m.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'packages/console/Dockerfile',
    read: (content) => /^ARG VERSION=(.+)$/m.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'packages/gateway/src/runtime/version.ts',
    read: (content) => /export const VERSION = '(.+)'/.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'packages/access/src/runtime/version.ts',
    read: (content) => /export const VERSION = '(.+)'/.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'packages/console/src/runtime/version.ts',
    read: (content) => /export const VERSION = '(.+)'/.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'CHANGELOG.md',
    // The latest release of the changelog: the first heading of a version.
    read: (content) => /^##\s+(\d+\.\d+\.\d+)/m.exec(content)?.[1]?.trim() ?? null,
  },
  // The status of a specification is the release that carries it: a
  // specification that describes another release describes a behaviour
  // the code does not have.
  {
    path: 'docs/gateway/spec.md',
    read: (content) => /^Status:\s*(\d+\.\d+\.\d+)/m.exec(content)?.[1] ?? null,
  },
  {
    path: 'docs/access/spec.md',
    read: (content) => /^Status:\s*(\d+\.\d+\.\d+)/m.exec(content)?.[1] ?? null,
  },
  {
    path: 'docs/data/spec.md',
    read: (content) => /^Status:\s*(\d+\.\d+\.\d+)/m.exec(content)?.[1] ?? null,
  },
  {
    path: 'docs/access/README.md',
    // The state of the release in the documentation of the service.
    read: (content) => /^Version `(\d+\.\d+\.\d+)`/m.exec(content)?.[1] ?? null,
  },
  // The deployment of the platform is one directory, at the root of the
  // repository, and the images it runs carry the version of the
  // platform: a manifest that points at an image of another version
  // deploys something else than the one that was released.
  {
    path: 'deploy/compose/production/gateway.compose.yaml',
    read: (content) =>
      /image:\s*ghcr\.io\/ggpwnkthx\/gateway:(.+)$/m.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'deploy/compose/production/access.compose.yaml',
    read: (content) =>
      /image:\s*ghcr\.io\/ggpwnkthx\/access:(.+)$/m.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'deploy/compose/production/data.compose.yaml',
    read: (content) =>
      /image:\s*ghcr\.io\/ggpwnkthx\/data:(.+)$/m.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'deploy/kubernetes/base/gateway/deployment.yaml',
    read: (content) =>
      /image:\s*ghcr\.io\/ggpwnkthx\/gateway:(.+)$/m.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'deploy/kubernetes/base/gateway/kustomization.yaml',
    read: (content) => /newTag:\s*(.+)$/m.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'deploy/kubernetes/base/access/deployment.yaml',
    read: (content) =>
      /image:\s*ghcr\.io\/ggpwnkthx\/access:(.+)$/m.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'deploy/kubernetes/base/access/kustomization.yaml',
    read: (content) => /newTag:\s*(.+)$/m.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'deploy/kubernetes/base/data/deployment.yaml',
    read: (content) =>
      /image:\s*ghcr\.io\/ggpwnkthx\/data:(.+)$/m.exec(content)?.[1]?.trim() ?? null,
  },
  {
    path: 'deploy/kubernetes/base/data/kustomization.yaml',
    read: (content) => /newTag:\s*(.+)$/m.exec(content)?.[1]?.trim() ?? null,
  },
]

/** Checks that the files hold the same version. */
export function checkVersionConsistency(files: Record<string, string>): VersionFinding[] {
  return checkConsistency(files, PLATFORM_VERSION_SOURCES)
}

/** Reads the files of the tree and checks that they agree. */
export async function checkVersions(root: string): Promise<VersionFinding[]> {
  const files = await readSources(root, PLATFORM_VERSION_SOURCES)
  return checkConsistency(files, PLATFORM_VERSION_SOURCES)
}

export { readPackageVersion, RELEASE_VERSION }

if (import.meta.main) {
  const root = process.cwd()
  const findings = await checkVersions(root)
  if (findings.length === 0) {
    console.log('the version of the platform is the same everywhere')
    process.exit(0)
  }
  for (const finding of findings) {
    console.error(`${finding.file}: ${finding.message}`)
  }
  console.error('the version of the platform is not the same everywhere')
  process.exit(1)
}
