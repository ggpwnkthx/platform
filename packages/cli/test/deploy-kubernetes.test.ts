import { describe, expect, test } from 'bun:test'
import { fake, kenv, settings } from './deploy-helpers.ts'
import { deploy } from '../src/deployment/index.ts'

describe('Kubernetes deployment orchestration', () => {
  test('render is offline and emits concrete, namespaced YAML without database credentials', async () => {
    const f = fake(kenv)
    f.r.which = () => null
    expect(await deploy(['k8s', 'render', '--namespace=team'], f.r)).toBe(0)
    const docs = f.output[0]!.split(/^---$/m).map((s) => Bun.YAML.parse(s)) as any[]
    expect(docs).toHaveLength(2)
    expect(docs.every((d) => d.metadata.namespace === 'team')).toBe(true)
    const [container] = docs[0].spec.template.spec.containers
    expect(container.image).toBe(settings.image)
    // The relay forwards to the database and allows only the site's own origin.
    expect(container.env.find((e: any) => e.name === 'RELAY_UPSTREAM').value).toBe(
      'db.internal:5432'
    )
    expect(container.env.find((e: any) => e.name === 'RELAY_ORIGINS').value).toBe(
      settings.publicUrl
    )
    expect(container.args).toBeUndefined()
    expect(
      (container.env ?? []).some((e: any) =>
        ['PGUSER', 'PGPASSWORD', 'DATABASE_URL'].includes(e.name)
      )
    ).toBe(false)
    expect(f.calls).toEqual([])
  })
  test('apply renders supplied settings then waits for rollout in the same namespace', async () => {
    const f = fake(kenv)
    expect(await deploy(['k8s', 'apply', '--namespace', 'team', '--timeout=60'], f.r)).toBe(0)
    expect(f.calls[0]!.argv).toEqual(['kubectl', '-n', 'team', 'apply', '-f', '-'])
    expect(f.calls[0]!.options?.input).toContain(settings.databaseHost)
    expect(f.calls[1]!.argv).toEqual([
      'kubectl',
      '-n',
      'team',
      'rollout',
      'status',
      'deployment/platform-relay',
      '--timeout=60s',
    ])
  })
  test('failed apply does not attempt a rollout, and diff preserves exit 1', async () => {
    const f = fake(kenv)
    f.r.run = async (argv, options) => {
      f.calls.push({ argv, options })
      return 1
    }
    expect(await deploy(['k8s', 'apply'], f.r)).toBe(1)
    expect(f.calls).toHaveLength(1)
    expect(await deploy(['k8s', 'diff'], f.r)).toBe(1)
  })
})
