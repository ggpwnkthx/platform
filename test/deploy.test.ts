import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkDeploy,
  checkLayout,
  checkMinimumEnvironment,
  checkStacks,
} from '../scripts/check-deploy'

/**
 * The deployment of the platform.
 *
 * Every file of a deployment is in `deploy/`, and every service of the
 * platform is deployed on its own and as part of the composition of the
 * three. These tests prove that the directory of the repository holds
 * what it should hold, and that the check answers when it does not.
 */
const root = join(import.meta.dir, '..')

describe('the directory of the deployment', () => {
  test('it holds what it should hold', async () => {
    expect(await checkDeploy(root)).toEqual([])
  })

  test('a deployment file outside of the directory is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-deploy-'))
    try {
      await mkdir(join(directory, 'packages', 'gateway', 'deploy'), { recursive: true })
      await mkdir(join(directory, 'deploy', 'compose'), { recursive: true })
      await mkdir(join(directory, 'deploy', 'kubernetes'), { recursive: true })
      await mkdir(join(directory, 'deploy', 'config'), { recursive: true })
      const findings = checkLayout(directory)
      expect(findings).toEqual([
        {
          file: 'packages/gateway/deploy',
          message: 'the deployment files are in the directory of the deployment',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a stack that deploys another service is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-deploy-'))
    try {
      await mkdir(join(directory, 'deploy', 'compose'), { recursive: true })
      await writeFile(
        join(directory, 'deploy', 'compose', 'gateway.compose.yaml'),
        'name: platform-gateway\nservices:\n  gateway:\n    image: gateway\n  access:\n    image: access\n'
      )
      const findings = await checkStacks(directory)
      expect(findings.some((finding) => finding.message.includes('deploys the access'))).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a stack that does not deploy a service is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-deploy-'))
    try {
      await mkdir(join(directory, 'deploy', 'compose'), { recursive: true })
      await writeFile(
        join(directory, 'deploy', 'compose', 'gateway.compose.yaml'),
        'name: platform-gateway\nservices:\n  dex:\n    image: ghcr.io/dexidp/dex:v2.46.1\n'
      )
      const findings = await checkStacks(directory)
      expect(
        findings.some((finding) => finding.message.includes('the stack does not deploy'))
      ).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a variable that a stack requires and the minimum environment does not hold is reported', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'platform-deploy-'))
    try {
      await mkdir(join(directory, 'deploy', 'compose'), { recursive: true })
      await writeFile(
        join(directory, 'deploy', 'compose', 'gateway.compose.yaml'),
        `name: platform-gateway
services:
  gateway:
    environment:
      GATEWAY_SESSION_SECRET: \${GATEWAY_SESSION_SECRET:?the secret of the sessions is required}
`
      )
      await writeFile(join(directory, '.env.min'), 'GATEWAY_OIDC_ISSUER=http://access:8081\n')
      const findings = await checkMinimumEnvironment(directory)
      expect(findings).toEqual([
        {
          file: '.env.min',
          message:
            'the variable GATEWAY_SESSION_SECRET is not set: the stack deploy/compose/gateway.compose.yaml refuses to start without it',
        },
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('the minimum environment holds every variable a stack requires', async () => {
    const findings = await checkMinimumEnvironment(root)
    expect(findings).toEqual([])
  })
})
