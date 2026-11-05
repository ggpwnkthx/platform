import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkoutOf, pathOf, placeOf } from '../src/platform/checkout'

/**
 * The checkout the command runs in.
 *
 * The CLI is run through the workspace of a package, and the workspace
 * is a directory of the checkout: the paths of the deployment are paths
 * of the checkout and not paths of the directory the command runs in.
 */

/**
 * A checkout of the repository, with a directory of the deployment in
 * it and a workspace of a package below it.
 */
async function checkoutOfTree(): Promise<{ checkout: string; workspace: string }> {
  const root = await mkdtemp(join(tmpdir(), 'platformctl-checkout-'))
  const checkout = join(root, 'platform')
  const workspace = join(checkout, 'packages', 'cli')
  await mkdir(join(checkout, 'deploy', 'tofu', 'azure'), { recursive: true })
  await mkdir(join(checkout, 'deploy', 'tofu', 'runtime', 'development'), { recursive: true })
  await mkdir(workspace, { recursive: true })
  return { checkout, workspace }
}

describe('the checkout of the command', () => {
  test('the checkout is found by walking up from the directory the command runs in', async () => {
    const { checkout, workspace } = await checkoutOfTree()
    try {
      expect(checkoutOf(workspace)).toBe(checkout)
      expect(checkoutOf(checkout)).toBe(checkout)
    } finally {
      await rm(join(checkout, '..'), { recursive: true, force: true })
    }
  })

  test('a command that runs outside of a checkout has none', async () => {
    const root = await mkdtemp(join(tmpdir(), 'platformctl-checkout-'))
    try {
      expect(checkoutOf(root)).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('a path the operator names', () => {
  test('a path that is there in the directory the command runs in is the path of that directory', async () => {
    const { checkout, workspace } = await checkoutOfTree()
    try {
      await writeFile(join(workspace, 'answers.tfvars'), '')
      expect(pathOf('answers.tfvars', workspace)).toBe(join(workspace, 'answers.tfvars'))
    } finally {
      await rm(join(checkout, '..'), { recursive: true, force: true })
    }
  })

  test('a path that is only in the checkout is the path of the checkout', async () => {
    const { checkout, workspace } = await checkoutOfTree()
    try {
      expect(pathOf(join('deploy', 'tofu', 'azure'), workspace)).toBe(
        join(checkout, 'deploy', 'tofu', 'azure')
      )
      expect(pathOf(join('deploy', 'tofu', 'runtime', 'development'), workspace)).toBe(
        join(checkout, 'deploy', 'tofu', 'runtime', 'development')
      )
    } finally {
      await rm(join(checkout, '..'), { recursive: true, force: true })
    }
  })

  test('a path that is nowhere is the path of the directory the command runs in', async () => {
    const { checkout, workspace } = await checkoutOfTree()
    try {
      expect(pathOf(join('deploy', 'tofu', 'nowhere'), workspace)).toBe(
        join(workspace, 'deploy', 'tofu', 'nowhere')
      )
    } finally {
      await rm(join(checkout, '..'), { recursive: true, force: true })
    }
  })

  test('a path that is absolute is the path it is', async () => {
    const { checkout, workspace } = await checkoutOfTree()
    try {
      const absolute = join(checkout, 'deploy', 'tofu', 'azure')
      expect(pathOf(absolute, workspace)).toBe(absolute)
    } finally {
      await rm(join(checkout, '..'), { recursive: true, force: true })
    }
  })
})

describe('a path the deployment names', () => {
  test('the path is the path of the checkout, and it is there when the deployment is new', async () => {
    const { checkout, workspace } = await checkoutOfTree()
    try {
      expect(placeOf(join('deploy', 'tofu', 'runtime', 'staging'), workspace)).toBe(
        join(checkout, 'deploy', 'tofu', 'runtime', 'staging')
      )
    } finally {
      await rm(join(checkout, '..'), { recursive: true, force: true })
    }
  })

  test('a command that runs outside of a checkout reads its paths from the directory it runs in', async () => {
    const root = await mkdtemp(join(tmpdir(), 'platformctl-checkout-'))
    try {
      expect(placeOf(join('deploy', 'tofu', 'azure'), root)).toBe(
        join(root, 'deploy', 'tofu', 'azure')
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
