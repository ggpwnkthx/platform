import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The images of the platform.
 *
 * The images are built from a base image that is pinned by its digest,
 * and the digest is of a build of a tag that was not rebuilt. The
 * libraries of Alpine are patched in the base image, and a library
 * that carries an advisory the scan of the image refuses is a library
 * that the image has to carry the fix of.
 *
 * The stage that patches the library is the base of every stage of the
 * image: a stage that starts from the image of the runtime bypasses the
 * patch, and the image of that stage carries the library that the fix
 * is for.
 */

/** The root of the repository. */
const root = join(import.meta.dir, '..')

/** The images of the platform. */
const IMAGES = ['gateway', 'access', 'data', 'console'] as const

/**
 * The advisories the base image has to carry the fix of.
 *
 * Alpine published the fix of the heap overflow of `zlib` in the
 * revision `1.3.2-r1` of the package, and the fix of the integer
 * overflow of `musl` in the revision `1.2.6-r3`: the images carry that
 * revision or a later one.
 */
const ADVISORIES = [
  { package: 'zlib', fix: '1.3.2-r1', advisory: 'CVE-2026-85091' },
  { package: 'musl', fix: '1.2.6-r3', advisory: 'CVE-2026-107891' },
  { package: 'musl-utils', fix: '1.2.6-r3', advisory: 'CVE-2026-107891' },
] as const

/** A stage of an image. */
interface Stage {
  /** The name of the stage. */
  readonly name: string
  /** The image the stage starts from. */
  readonly from: string
  /** The lines of the stage. */
  readonly body: readonly string[]
}

/**
 * The stages of an image.
 *
 * A stage is a block of the file that starts with a `FROM`, and it ends
 * where the next one starts.
 *
 * @param content the content of the file of the image.
 */
function stagesOf(content: string): Stage[] {
  const lines = content.split('\n')
  const stages: Stage[] = []
  let current: { name: string; from: string; body: string[] } | undefined
  for (const line of lines) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/.exec(line)
    if (from) {
      if (current) stages.push(current)
      current = { name: from[2] ?? from[1]!, from: from[1]!, body: [] }
      continue
    }
    current?.body.push(line)
  }
  if (current) stages.push(current)
  return stages
}

/**
 * The version of a constraint of a package.
 *
 * The constraint of a package of Alpine is a version and an operator:
 * `>=1.3.2-r1` is a floor, and the floor is read as the version that
 * follows it.
 *
 * @param constraint the constraint of the line of the image.
 */
function versionOf(constraint: string): { operator: string; version: string } | undefined {
  const found = /^(>=|<=|>|<|=|~)?([0-9]+(?:\.[0-9]+)*(?:-r[0-9]+)?)$/.exec(constraint)
  if (found === null) return undefined
  return { operator: found[1] ?? '=', version: found[2]! }
}

/**
 * The comparison of two versions of a package of Alpine.
 *
 * The revision of the package is the last part of the version, and it
 * counts after the numbers that come before it.
 *
 * @param one the first version.
 * @param two the second version.
 */
function compare(one: string, two: string): number {
  const parts = (version: string): number[] =>
    version
      .split('-r')
      .flatMap((part, index) => (index === 0 ? part.split('.').map(Number) : [Number(part)]))
  const left = parts(one)
  const right = parts(two)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    if (a !== b) return a > b ? 1 : -1
  }
  return 0
}

describe('the images of the platform', () => {
  test('every image patches the library that the advisory is for', () => {
    const findings: string[] = []
    for (const service of IMAGES) {
      const file = join(root, 'packages', service, 'Dockerfile')
      const content = readFileSync(file, 'utf8')
      const stages = stagesOf(content)
      const base = stages.find((stage) => stage.from.includes('oven/bun:'))
      if (base === undefined) {
        findings.push(`${service}: the image starts from no image of the runtime`)
        continue
      }
      const patch = base.body.find((line) => line.includes('apk add'))
      if (patch === undefined) {
        findings.push(`${service}: the image patches no library of the base image`)
        continue
      }
      for (const { package: name, fix, advisory } of ADVISORIES) {
        const constraint = new RegExp(
          `${name}(>=|<=|>|<|=|~)?([0-9]+(?:\\.[0-9]+)*(?:-r[0-9]+)?)`
        ).exec(patch)
        if (constraint === null) {
          findings.push(`${service}: the image does not patch ${name}`)
          continue
        }
        const operator = constraint[1] ?? '='
        const version = constraint[2]!
        const read = versionOf(`${operator}${version}`)
        if (read === undefined) {
          findings.push(`${service}: the constraint of ${name} is not a version: ${constraint[0]}`)
          continue
        }
        // The patch is a floor: the fix of the advisory, or a later
        // revision of the library.
        if (operator !== '>=' && operator !== '=') {
          findings.push(`${service}: the patch of ${name} is not a floor: ${constraint[0]}`)
          continue
        }
        if (compare(version, fix) < 0) {
          findings.push(
            `${service}: ${name} ${version} is older than the fix of ${advisory}: ${fix}`
          )
        }
      }
    }
    expect(findings).toEqual([])
  })

  test('every stage of every image starts from the stage that patches the library', () => {
    const findings: string[] = []
    for (const service of IMAGES) {
      const file = join(root, 'packages', service, 'Dockerfile')
      const content = readFileSync(file, 'utf8')
      const stages = stagesOf(content)
      const base = stages.find((stage) => stage.from.includes('oven/bun:'))
      if (base === undefined) continue
      for (const stage of stages) {
        if (stage === base) continue
        if (stage.from !== 'base') {
          findings.push(
            `${service}: the stage ${stage.name} starts from ${stage.from} and carries the library that the fix is for`
          )
        }
      }
    }
    expect(findings).toEqual([])
  })
})
