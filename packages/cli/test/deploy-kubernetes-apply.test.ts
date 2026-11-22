import { describe, expect, test } from 'bun:test'
import { fake, kenv, settings } from './deploy-helpers.ts'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deploy, renderKubernetes } from '../src/deployment/index.ts'

describe('Kubernetes deployment orchestration', () => {
  test('validate uses a server-side dry run and status needs no image configuration', async () => {
    const f = fake(kenv)
    await deploy(['k8s', 'validate'], f.r)
    expect(f.calls[0]!.argv).toContain('--dry-run=server')
    const status = fake()
    expect(await deploy(['k8s', 'status'], status.r)).toBe(0)
    expect(status.calls[0]!.argv).toContain('deployment,service,pod')
  })
  test('render rejects placeholders, insecure origins and invalid port values', () => {
    expect(() => renderKubernetes({ ...settings, image: '' })).toThrow('--image')
    expect(() => renderKubernetes({ ...settings, publicUrl: 'http://example.com' })).toThrow(
      'HTTPS'
    )
    expect(() => renderKubernetes({ ...settings, oidcIssuer: '' })).toThrow('--oidc-issuer')
    expect(() => renderKubernetes({ ...settings, oidcIssuer: 'http://sso.example.com' })).toThrow(
      'OIDC_ISSUER must be an HTTPS URL'
    )
    expect(() => renderKubernetes({ ...settings, databasePort: '5432\nmalicious' })).toThrow('port')
    expect(() => renderKubernetes({ ...settings, databaseHost: 'db --conncap 1' })).toThrow(
      'host name'
    )
    expect(() => renderKubernetes({ ...settings, namespace: 'bad/namespace' })).toThrow('namespace')
  })
  test('YAML string quoting prevents values from creating extra configuration', () => {
    const yaml = renderKubernetes({ ...settings, publicUrl: 'https://platform.example.com/?a="b' })
    const doc = Bun.YAML.parse(yaml.split(/^---$/m)[0]!) as any
    expect(
      doc.spec.template.spec.containers[0].env.find((e: any) => e.name === 'RELAY_ORIGINS').value
    ).toBe('https://platform.example.com/?a="b')
  })
})

test('CLI apply invokes the real subprocess adapter and sends the manifest through stdin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'platform-deploy-'))
  try {
    writeFileSync(
      join(dir, 'kubectl'),
      `#!/bin/sh
printf '%s\\n' "$@" >> "$DEPLOY_TEST_CALLS"
if [ "$3" = "apply" ]; then cat > "$DEPLOY_TEST_MANIFEST"; fi
`,
      { mode: 0o755 }
    )
    const child = Bun.spawn(
      [process.execPath, 'packages/cli/src/cli.ts', 'deploy', 'k8s', 'apply'],
      {
        cwd: new URL('../../..', import.meta.url).pathname,
        env: {
          PATH: dir + ':' + process.env.PATH,
          // The settings of the deployment live in a file of their own: the checkout's is
          // the operator's, and this run must not touch it.
          PLATFORM_ENV_FILE: join(dir, '.env'),
          ...kenv,
          DEPLOY_TEST_CALLS: join(dir, 'calls'),
          DEPLOY_TEST_MANIFEST: join(dir, 'manifest'),
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      }
    )
    const stderr = await new Response(child.stderr).text()
    // The configuration is written on the way, and says so on stderr; stdout carries the
    // deployment's own words.
    expect(stderr).toContain('Configuration:')
    expect(await new Response(child.stdout).text()).toContain('The relay is deployed')
    expect(await child.exited).toBe(0)
    expect(readFileSync(join(dir, 'calls'), 'utf8')).toContain('rollout')
    expect(readFileSync(join(dir, 'manifest'), 'utf8')).toContain(settings.image)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
