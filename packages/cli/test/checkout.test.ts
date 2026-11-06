import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'bun'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkoutOf,
  pathOf,
  placeOf,
  templatesAtTagOf,
  templatesStateOf,
} from '../src/platform/checkout'

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

/**
 * A repository with a tag and a directory of templates in it.
 *
 * The repository holds one commit and one tag, and the templates of
 * the deployment are a file in it.
 */
async function repositoryOf(): Promise<{ root: string; templates: string }> {
  const root = await mkdtemp(join(tmpdir(), 'platformctl-repository-'))
  const templates = join(root, 'deploy', 'tofu', 'azure')
  await mkdir(templates, { recursive: true })
  await writeFile(join(templates, 'locals.tf'), 'version = 1\n')
  const git = (...args: string[]): void => {
    const answer = spawnSync(['git', ...args], { cwd: root, stdout: 'ignore' })
    if (answer.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed`)
  }
  git('init', '--quiet')
  git('config', 'user.email', 'operator@example.com')
  git('config', 'user.name', 'the operator')
  git('add', '.')
  git('commit', '--quiet', '--message', 'the templates')
  git('tag', 'v1.0.4')
  return { root, templates }
}

describe('the templates of a checkout against the tag of a release', () => {
  test('the templates of the tag are the templates of the checkout', async () => {
    const { root, templates } = await repositoryOf()
    try {
      expect(await templatesStateOf(templates, 'v1.0.4')).toBe('same')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('templates that are not the ones of the tag are told', async () => {
    const { root, templates } = await repositoryOf()
    try {
      await writeFile(join(templates, 'locals.tf'), 'version = 2\n')
      expect(await templatesStateOf(templates, 'v1.0.4')).toBe('different')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a tag that is not in the checkout tells nothing', async () => {
    const { root, templates } = await repositoryOf()
    try {
      expect(await templatesStateOf(templates, 'v9.9.9')).toBe('unknown')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a directory that is in no repository tells nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'platformctl-repository-'))
    try {
      expect(await templatesStateOf(root, 'v1.0.4')).toBe('unknown')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('the files of the templates at the tag of a release', () => {
  test('the files of the tag are the files of the templates', async () => {
    const { root, templates } = await repositoryOf()
    try {
      const files = await templatesAtTagOf(templates, 'v1.0.4')
      expect(files).toBeDefined()
      expect(files?.['locals.tf']).toBe('version = 1\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a tag that is not in the checkout holds no files', async () => {
    const { root, templates } = await repositoryOf()
    try {
      expect(await templatesAtTagOf(templates, 'v9.9.9')).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a directory that is in no repository holds no files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'platformctl-repository-'))
    try {
      expect(await templatesAtTagOf(root, 'v1.0.4')).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
