import { describe, expect, test } from 'bun:test'
import { fake } from './deploy-helpers.ts'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deploy } from '../src/deployment/index.ts'

describe('the configuration of a deployment', () => {
  test('a missing configuration is written by asking, and kept out of git', async () => {
    const f = fake({}, { PLATFORM_PUBLIC_URL: 'https://platform.example.com' }, true)
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    // What the operator was asked, and what the answers are worth.
    expect(f.asked).toContain('PLATFORM_PUBLIC_URL')
    expect(f.asked).toContain('RELAY_PORT')
    const saved = readFileSync(f.envFile, 'utf8')
    expect(saved).toContain('PLATFORM_PUBLIC_URL=https://platform.example.com')
    // The services answer on their own sub-domains of the deployment's domain.
    expect(saved).toContain('PLATFORM_DOMAIN=localhost')
    // The file holds the pieces only: the addresses are made of them at runtime.
    expect(saved).not.toContain('PLATFORM_ISSUER')
    expect(saved).not.toContain('PLATFORM_RELAY_URL')
    expect(saved).not.toContain('DATABASE_HOST')
    expect(f.r.env.PLATFORM_ISSUER).toBe('http://idp.localhost:8080')
    expect(f.r.env.PLATFORM_RELAY_URL).toBe('ws://api.localhost:8080')
    expect(f.r.env.DATABASE_HOST).toBe('db.localhost')
    // The one password there is, the break-glass administrator's, is generated and never
    // printed. Nobody else has one.
    expect(saved).toMatch(/^PLATFORM_ADMIN_PASSWORD=[\w-]{32}$/m)
    expect(saved).not.toContain('ALICE_PASSWORD')
    expect(saved).not.toContain('BOB_PASSWORD')
    expect(JSON.stringify(f.output)).not.toMatch(/PASSWORD=[\w-]{32}/)
    // The file holds secrets: it is the operator's alone, and git never sees it.
    expect(statSync(f.envFile).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(dirname(f.envFile), '.gitignore'), 'utf8')).toContain('.env')
    // The answers are what the deployment then uses.
    expect(f.r.env.PLATFORM_PUBLIC_URL).toBe('https://platform.example.com')
    expect(f.r.env.RELAY_PORT).toBe('8081')
  })
  test('a configuration that is already there is completed, not rewritten', async () => {
    const f = fake({}, {}, true)
    writeFileSync(f.envFile, 'PLATFORM_PUBLIC_URL=https://kept.example.com\n')
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    // What the file holds is kept; what it lacks is asked for and added to it.
    expect(f.asked).toContain('PLATFORM_DOMAIN')
    const file = readFileSync(f.envFile, 'utf8')
    expect(file).toStartWith('PLATFORM_PUBLIC_URL=https://kept.example.com\n')
    expect(file).toContain('PLATFORM_DOMAIN=localhost')
    // The addresses are not kept: they are made of the pieces.
    expect(file).not.toContain('PLATFORM_ISSUER')
  })
  test('the values a file held that are computed now are taken out of it', async () => {
    const f = fake()
    writeFileSync(
      f.envFile,
      [
        'PLATFORM_DOMAIN=localhost',
        'PLATFORM_ISSUER=http://idp.localhost:8080',
        'OIDC_ISSUER=http://idp.localhost:8080',
        'PLATFORM_RELAY_URL=ws://api.localhost:8080',
        'DATABASE_HOST=db.localhost',
        'PLATFORM_PUBLIC_URL=http://app.localhost:5173',
        '',
      ].join('\n')
    )
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    const file = readFileSync(f.envFile, 'utf8')
    // The pieces are kept; the addresses are made of them now.
    expect(file).toContain('PLATFORM_DOMAIN=localhost')
    expect(file).not.toContain('PLATFORM_ISSUER')
    expect(file).not.toContain('OIDC_ISSUER')
    expect(file).not.toContain('PLATFORM_RELAY_URL')
    expect(file).not.toContain('DATABASE_HOST')
    expect(file).not.toContain('PLATFORM_PUBLIC_URL')
    // And the addresses are right.
    expect(f.r.env.PLATFORM_ISSUER).toBe('http://idp.localhost:8080')
    expect(f.r.env.PLATFORM_RELAY_URL).toBe('ws://api.localhost:8080')
    expect(f.r.env.DATABASE_HOST).toBe('db.localhost')
  })
  test('what was answered is shown before it is written, and refusing it writes nothing', async () => {
    const f = fake({}, { PLATFORM_DOMAIN: 'wrong.example.com', write: 'no' }, true)
    await expect(deploy(['local', 'validate'], f.r)).rejects.toThrow('Cancelled')
    // Why the questions are asked is said before the first of them.
    expect(f.notes[0]).toContain('no .env was found')
    // The answers are shown with what follows from them, and the password is not.
    const shown = f.notes.find((note) => note.includes('What is added to .env')) ?? ''
    expect(shown).toContain('PLATFORM_DOMAIN')
    expect(shown).toContain('wrong.example.com')
    expect(shown).toContain('http://idp.wrong.example.com:8080')
    expect(shown).toMatch(/PLATFORM_ADMIN_PASSWORD\s+\(generated\)/)
    expect(existsSync(f.envFile)).toBe(false)
    expect(f.calls).toEqual([])
  })
  test('without a terminal the defaults are written, and nothing is asked', async () => {
    const f = fake()
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    expect(f.asked).toEqual([])
    const saved = readFileSync(f.envFile, 'utf8')
    // No site that already exists: one is deployed, on its own sub-domain, and
    // its address is made of the domain and it rather than kept.
    expect(saved).not.toContain('PLATFORM_PUBLIC_URL')
    expect(saved).toContain('PLATFORM_APP_HOST=app')
    expect(f.r.env.PLATFORM_SITE_URL).toBe('http://app.localhost:5173')
    expect(saved).toContain('DEX_PORT=5556')
    expect(saved).toMatch(/^PLATFORM_ADMIN_PASSWORD=[\w-]{32}$/m)
  })
  test('what the command line gave is kept, and only the rest is asked for', async () => {
    const f = fake({}, {}, true)
    expect(
      await deploy(
        [
          'k8s',
          'render',
          '--domain=platform.example.com',
          '--image=registry.example.com/platform:2.3.0',
          '--public-url=https://platform.example.com',
          '--oidc-issuer=https://sso.example.com/dex',
          '--database-host=db.internal',
        ],
        f.r
      )
    ).toBe(0)
    expect(f.asked).toEqual([
      'PLATFORM_IDP_HOST',
      'PLATFORM_API_HOST',
      'PLATFORM_DB_HOST',
      'DATABASE_PORT',
      // The last question: whether what was answered is written down.
      'write',
    ])
    const saved = readFileSync(f.envFile, 'utf8')
    expect(saved).toContain('PLATFORM_DOMAIN=platform.example.com')
    expect(saved).toContain('PLATFORM_IMAGE=registry.example.com/platform:2.3.0')
    expect(saved).toContain('DATABASE_PORT=5432')
    // The database's name is the same for every deployment: it is worked out, not kept.
    expect(saved).not.toContain('DATABASE_NAME')
  })
  test('a Kubernetes deployment with nothing given writes nothing, and says what is missing', async () => {
    const f = fake()
    await expect(deploy(['k8s', 'render'], f.r)).rejects.toThrow('--domain')
    expect(existsSync(f.envFile)).toBe(false)
    expect(f.notes.join('\n')).toContain('PLATFORM_DOMAIN')
  })
  test('the names of the deployment follow from its domain, and are asked for', async () => {
    const f = fake(
      {},
      {
        PLATFORM_DOMAIN: 'dex.local',
        PLATFORM_IDP_HOST: 'idp',
        PLATFORM_API_HOST: 'api',
        PLATFORM_DB_HOST: 'db',
        PLATFORM_PUBLIC_URL: 'https://dex.local',
      },
      true
    )
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    const saved = readFileSync(f.envFile, 'utf8')
    expect(saved).toContain('PLATFORM_DOMAIN=dex.local')
    // The addresses follow from the names, at runtime.
    expect(f.r.env.PLATFORM_ISSUER).toBe('http://idp.dex.local:8080')
    expect(f.r.env.PLATFORM_RELAY_URL).toBe('ws://api.dex.local:8080')
    expect(f.r.env.DATABASE_HOST).toBe('db.dex.local')
    // The names have to answer on this machine: the browser and the operator's tools.
    expect(f.hosts).toEqual(['idp.dex.local', 'api.dex.local', 'db.dex.local'])
  })
  test('a site that already exists is asked for by its full URL, and none is deployed', async () => {
    const f = fake({}, { PLATFORM_PUBLIC_URL: 'https://console.example.com' }, true)
    expect(await deploy(['local', 'up'], f.r)).toBe(0)
    // The operator is asked for the address of the site, and no site is deployed.
    expect(f.asked).toContain('PLATFORM_PUBLIC_URL')
    expect(f.asked).not.toContain('PLATFORM_APP_HOST')
    const saved = readFileSync(f.envFile, 'utf8')
    expect(saved).toContain('PLATFORM_PUBLIC_URL=https://console.example.com')
    expect(saved).not.toContain('PLATFORM_APP_HOST')
  })
})
