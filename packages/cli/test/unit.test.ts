import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { ident, literal } from '@platform/vocabulary'
import { bearer } from '../src/database/db.ts'
import { loadConfig } from '../src/database/config.ts'
import { MIGRATIONS } from '../src/migrations.ts'
import { fieldSchema, fieldSql } from '../src/model.ts'
import { parseManifest } from '../src/apply.ts'
import { administratorManifest, deploymentAdmin, deploymentVariables } from '../src/folder.ts'
import newsroomModels from '../../../examples/newsroom/apply/models.ts'

describe('SQL construction and credentials', () => {
  test('quotes identifiers without treating names as SQL', () => {
    expect(ident('a"; DROP TABLE x;--')).toBe('"a""; DROP TABLE x;--"')
    expect(() => ident('a\0b')).toThrow()
    expect(() => ident('é'.repeat(32))).toThrow()
    expect(() => ident('')).toThrow()
  })
  test('DDL literals handle quotes and backslashes', () => {
    expect(literal("a\\'; DROP TABLE x;--")).toBe("E'a\\\\''; DROP TABLE x;--'")
    expect(literal({ a: 1 })).toBe(`E'{"a":1}'`)
    expect(() => literal('\0')).toThrow()
  })
  test('a bearer token names the role to log in, and nothing else is accepted', () => {
    const token = (claims: unknown) =>
      `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.c2ln`
    const mine = token({ email: 'zoë@example.com', preferred_username: 'zoe' })
    expect(bearer(`Bearer ${mine}`, 'email')).toEqual({ username: 'zoë@example.com', token: mine })
    expect(bearer(`Bearer ${mine}`, 'preferred_username').username).toBe('zoe')
    for (const bad of [
      undefined,
      'Basic ' + Buffer.from('isaac:password').toString('base64'),
      'Bearer abc',
      'Bearer a.b',
      `Bearer ${mine} extra`,
      `Bearer ${token({})}`,
      `Bearer ${token({ email: 7 })}`,
      `Bearer ${token({ email: 'x'.repeat(64) })}`,
      `Bearer ${token({ email: 'a\0b' })}`,
      `Bearer ${token(null)}`,
      'Bearer e30.bm90LWpzb24.c2ln',
    ])
      expect(() => bearer(bad, 'email')).toThrow()
  })
  test('fields become native constraints', () => {
    const sql = fieldSql(
      fieldSchema.parse({
        name: 'title',
        type: 'string',
        required: true,
        options: { max_length: 120 },
      })
    )
    expect(sql).toContain('NOT NULL')
    expect(sql).toContain('CHECK (char_length("title") <= 120)')
    expect(() => fieldSql(fieldSchema.parse({ name: 'created_by', type: 'text' }))).toThrow(
      'Reserved'
    )
  })
  test('a manifest may say where a field appears', () => {
    const field = fieldSchema.parse({
      name: 'internal_notes',
      type: 'string',
      views: { list: 'hide', export: 'hide' },
    })
    expect(field.views).toEqual({ list: 'hide', export: 'hide' })
    // A field that says nothing is given the platform's default views.
    expect(fieldSchema.parse({ name: 'title', type: 'string' }).views).toEqual({})
    expect(() =>
      fieldSchema.parse({ name: 'title', type: 'string', views: { list: 'perhaps' } })
    ).toThrow()
  })
  test('a field says what it is called in its metadata, and where it appears in its views', () => {
    const field = fieldSchema.parse({
      name: 'title',
      type: 'string',
      metadata: { display_name: 'Headline' },
    })
    expect(field.metadata).toEqual({ display_name: 'Headline' })
    expect(() =>
      fieldSchema.parse({ name: 'title', type: 'string', metadata: { views: { list: 'hide' } } })
    ).toThrow()
  })
  test('a manifest may only name the privileges the platform knows', () => {
    const manifest = (privileges: string[]) => ({
      workspaces: [{ slug: 'newsroom', grants: [{ to: 'writer', privileges }] }],
    })
    expect(() => parseManifest(manifest(['select', 'insert']))).not.toThrow()
    expect(() => parseManifest(manifest(['usage']))).not.toThrow()
    expect(() => parseManifest(manifest(['choose']))).toThrow()
  })
  test('the manifest a folder applies is one the platform accepts, under the deployment’s administrator', () => {
    // The administrator is the deployment's own: the one it names, or `admin` on its domain.
    expect(
      deploymentAdmin({ PLATFORM_ADMIN: 'root@corp.example', PLATFORM_DOMAIN: 'x.example' })
    ).toBe('root@corp.example')
    expect(deploymentAdmin({ PLATFORM_DOMAIN: 'platform.example.org' })).toBe(
      'admin@platform.example.org'
    )
    expect(deploymentAdmin({})).toBe('admin@example.com')
    expect(deploymentVariables({ PLATFORM_DOMAIN: 'localhost' })).toEqual({
      admin: 'admin@localhost',
    })
    const manifest = parseManifest(newsroomModels({ admin: 'admin@localhost' }))
    expect(manifest.users.map((user) => user.name)).toEqual([
      'admin@localhost',
      'alice@example.com',
      'bob@example.com',
    ])
    expect(manifest.workspaces.map((workspace) => [workspace.slug, workspace.owner])).toEqual([
      ['newsroom', 'admin@localhost'],
      ['crm', 'sales'],
    ])
  })
  test('a deployment whose site applies nothing is given its administrator and nothing else', () => {
    const manifest = parseManifest(administratorManifest('root@corp.example'))
    expect(manifest.users).toMatchObject([{ name: 'root@corp.example', admin: true }])
    expect(manifest.groups).toEqual([])
    expect(manifest.workspaces).toEqual([])
  })
})

describe('the operator commands’ settings', () => {
  test('a connection URL is refused: the commands name the host, port and database', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://u:p@h/db' })).toThrow(/obsolete/)
    expect(() => loadConfig({ DATABASE_SCHEMA_URL: 'postgres://u:p@h/db' })).toThrow(/obsolete/)
  })
  test('the issuer is read without a trailing slash, and TLS is the default', () => {
    const config = loadConfig({ OIDC_ISSUER: 'https://sso.example.com/dex/' })
    expect(config.oidcIssuer).toBe('https://sso.example.com/dex')
    expect(config.databaseSsl).toBe('require')
    expect(config.oidcClaim).toBe('email')
  })
})

describe('the installation scripts', () => {
  test('are every file in migrations/, in order, each carried as what the file says', () => {
    const directory = new URL('../../../migrations/', import.meta.url)
    const files = readdirSync(directory)
      .filter((file) => file.endsWith('.sql'))
      .sort()
    expect(MIGRATIONS.map((script) => script.file)).toEqual(files)
    for (const script of MIGRATIONS)
      expect(script.sql).toBe(readFileSync(new URL(script.file, directory), 'utf8'))
  })
})
