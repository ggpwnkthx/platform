#!/usr/bin/env bun
/**
 * Raises the version of the platform to the next one.
 *
 * The version of the platform is written in one place per file, and the
 * files have to agree: a file that names another version describes
 * another release. The check of the versions holds them to that, and the
 * tagger refuses to cut a tag when they disagree.
 *
 *   bun run scripts/bump.ts 1.0.1
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PLATFORM_VERSION_SOURCES } from './version'

const root = resolve(import.meta.dir, '..')
const next = process.argv[2]
if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('the version is needed: bun run scripts/bump.ts 1.0.1')
  process.exit(2)
}

/** The patterns that carry the version, by the kind of the file. */
const PATTERNS: { readonly match: RegExp; readonly replace: string }[] = [
  // The package of the root and the packages of the workspaces.
  { match: /("version":\s*")\d+\.\d+\.\d+(")/g, replace: `$1${next}$2` },
  // The images of the workspaces.
  { match: /^(\s*ARG VERSION=)\d+\.\d+\.\d+$/gm, replace: `$1${next}` },
  // The version the services and the CLI answer with.
  { match: /(export const VERSION = ')\d+\.\d+\.\d+(')/g, replace: `$1${next}$2` },
  // The status of the specification of each workspace.
  { match: /^(\s*Status:\s*)\d+\.\d+\.\d+/gm, replace: `$1${next}` },
  // The version of the documentation of a service.
  { match: /^(\s*Version `)\d+\.\d+\.\d+(`)/gm, replace: `$1${next}$2` },
  // The images of the stacks, of the manifests and of the tables of the
  // documentation.
  {
    match: /(ghcr\.io\/ggpwnkthx\/(?:gateway|access|data|console):)\d+\.\d+\.\d+/g,
    replace: `$1${next}`,
  },
  // The tag of the manifests.
  { match: /^(\s*newTag:\s*)\d+\.\d+\.\d+$/gm, replace: `$1${next}` },
  // The links to the release and to the assets of the release.
  { match: /(releases\/(?:download|tag)\/v)\d+\.\d+\.\d+/g, replace: `$1${next}` },
  { match: /(blob\/v)\d+\.\d+\.\d+/g, replace: `$1${next}` },
  // The name of a tag, wherever it is written.
  { match: /(\bv)\d+\.\d+\.\d+\b/g, replace: `$1${next}` },
  { match: /(platformctl-)\d+\.\d+\.\d+(-)/g, replace: `$1${next}$2` },
  { match: /(data-backend-client-)\d+\.\d+\.\d+(\.tgz)/g, replace: `$1${next}$2` },
]

/**
 * The files that name the release in prose.
 *
 * They are not part of the sources of the version: a sentence that
 * names a tag is an example and not a contract. The bump still raises
 * them, because a command that names a release that is not there is a
 * command that does not work.
 */
const ALSO_BUMPED: readonly string[] = [
  'docs/access/internals.md',
  'docs/gateway/upstream-identity.md',
]

for (const source of PLATFORM_VERSION_SOURCES) {
  const path = join(root, source.path)
  const content = readFileSync(path, 'utf8')
  if (source.path === 'CHANGELOG.md') {
    writeFileSync(path, changelogOf(content, next))
    continue
  }
  let rewritten = content
  for (const pattern of PATTERNS) {
    rewritten = rewritten.replace(pattern.match, pattern.replace)
  }
  if (rewritten !== content) writeFileSync(path, rewritten)
}

for (const path of ALSO_BUMPED) {
  const file = join(root, path)
  const content = readFileSync(file, 'utf8')
  const rewritten = content
    .replace(/(\bv)\d+\.\d+\.\d+\b/g, `$1${next}`)
    .replace(/(`)\d+\.\d+\.\d+(`)/g, `$1${next}$2`)
    .replace(/((?:access|gateway|data)-)\d+\.\d+\.\d+(-linux)/g, `$1${next}$2`)
  if (rewritten !== content) writeFileSync(file, rewritten)
}

/**
 * Moves the unreleased entries under the version of the release.
 *
 * @param content the changelog.
 * @param version the version of the release.
 */
function changelogOf(content: string, version: string): string {
  // A changelog that already holds the version is left alone: the bump
  // is run again when a pattern does not hold every file.
  if (new RegExp(`^## ${version.replace(/\./g, '\\.')}\n`, 'm').test(content)) return content
  const unreleased = /^## Unreleased\n/m.exec(content)
  const released = /^## \d+\.\d+\.\d+\n/m.exec(content)
  if (!unreleased || !released) return content
  const between = content.slice(unreleased.index + unreleased[0].length, released.index)
  const head = content.slice(0, unreleased.index + unreleased[0].length)
  const tail = content.slice(released.index)
  return `${head}\n## ${version}\n${between}\n${tail}`
}
