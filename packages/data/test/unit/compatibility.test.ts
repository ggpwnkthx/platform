import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  type CompatibilityManifest,
  readCompatibilityManifest,
} from '../../../../tooling/compatibility/manifest'
import {
  baselineBlock,
  checkBaselineDrift,
  manifestBlock,
} from '../../scripts/compat/check-compatibility'

/**
 * The drift of the baseline of Data.
 *
 * The manifest of the baseline lives at the root of the platform: it
 * owns the workspaces of the three services. The specification of the
 * Data and its guide show the baseline, and the blocks they show
 * are generated from the manifest: a baseline that is written twice
 * drifts.
 *
 * The manifest itself and the acquisition of the references are checked
 * by the tests of the platform, at the root of the repository.
 */
const manifest: CompatibilityManifest = await readCompatibilityManifest(
  join(import.meta.dir, '..', '..', '..', '..', 'compatibility.json')
)

describe('the drift of the baseline', () => {
  test('the block of the baseline agrees with the manifest', () => {
    const specs = `${baselineBlock(manifest)}\n`
    expect(checkBaselineDrift({ manifest, specs, workflows: [] })).toHaveLength(0)
  })

  test('a workspace that is not the one of the manifest is a drift', () => {
    const specs = baselineBlock({
      ...manifest,
      workspaces: {
        ...manifest.workspaces,
        gateway: { path: 'another-gateway' },
      },
    })
    const problems = checkBaselineDrift({ manifest, specs, workflows: [] })
    expect(problems.length).toBeGreaterThan(0)
  })

  test('a workflow that holds a revision is a drift', () => {
    const problems = checkBaselineDrift({
      manifest,
      specs: baselineBlock(manifest),
      workflows: [
        {
          name: 'ci.yml',
          text: `GATEWAY_COMMIT: ${'a'.repeat(40)}`,
        },
      ],
    })
    expect(problems.length).toBeGreaterThan(0)
  })

  test('the block of the manifest of the guide agrees with the manifest', () => {
    const problems = checkBaselineDrift({
      manifest,
      specs: baselineBlock(manifest),
      guide: manifestBlock(manifest),
      workflows: [],
    })
    expect(problems).toHaveLength(0)
  })

  test('a guide that holds another baseline is a drift', () => {
    const guide = manifestBlock({
      ...manifest,
      workspaces: {
        ...manifest.workspaces,
        access: { path: 'another-access' },
      },
    })
    const problems = checkBaselineDrift({
      manifest,
      specs: baselineBlock(manifest),
      guide,
      workflows: [],
    })
    expect(problems.length).toBeGreaterThan(0)
  })

  test('a guide without the block of the manifest is a drift', () => {
    const problems = checkBaselineDrift({
      manifest,
      specs: baselineBlock(manifest),
      guide: 'the guide without the block',
      workflows: [],
    })
    expect(problems.length).toBeGreaterThan(0)
  })

  test('a specification without the block of the baseline is a drift', () => {
    const problems = checkBaselineDrift({
      manifest,
      specs: 'the specification without the block',
      workflows: [],
    })
    expect(problems.length).toBeGreaterThan(0)
  })
})
