import { beforeAll, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Catalog, catalog, columnMetadata } from '@platform/core'
import { world } from '../../core/test/world.ts'
import { defaultRuntimeConfig, headersFile } from '../src/config.ts'
import { reachesOf, resolveColumns } from '../src/columns/resolve.ts'
import { familyOf, palette, tone } from '../src/kit/palette.ts'

let w: Awaited<ReturnType<typeof world>>
let held: Catalog
beforeAll(async () => {
  w = await world()
  held = await catalog(await w.as('alice@example.com'))
})
const columnsOf = async (table: string) =>
  resolveColumns(held, 'newsroom', table, await columnMetadata(w.db, 'newsroom', table))

const source = join(import.meta.dir, '../src')
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]
  )

describe('the columns of a table, as the interface meets them', () => {
  test('a column is claimed by the type that fits it best', async () => {
    const columns = Object.fromEntries((await columnsOf('articles')).map((f) => [f.name, f]))
    expect(columns.title!.type.name).toBe('text')
    expect(columns.title!.label).toBe('Headline')
    expect(columns.status!.type.name).toBe('choice')
    expect(columns.status!.choices).toEqual(['draft', 'review', 'published'])
    expect(columns.section!.type.name).toBe('relation')
    expect(columns.word_count!.type.name).toBe('integer')
    expect(columns.word_count!.renderers.list?.renderer).toBe('reading-time')
    expect(columns.version!.system).toBe(true)
  })
  test('PostgreSQL said what the reader may read and write, and the column carries the answer', async () => {
    const columns = Object.fromEntries((await columnsOf('articles')).map((f) => [f.name, f]))
    expect(columns.internal_notes!.column).toMatchObject({ can_select: false, can_update: false })
    // The name of a column she may not read is not hers to learn: its metadata is not returned.
    expect(columns.internal_notes!.label).toBe('internal_notes')
    expect(columns.title!.column).toMatchObject({ can_select: true, can_update: true })
    expect(columns.published_at!.column).toMatchObject({ can_select: true, can_update: false })
  })
  test('a join table is the rows a row is linked to; a key that points here is its children', async () => {
    const columns = await columnsOf('articles')
    const links = columns.find((f) => f.link?.kind === 'links')!
    const children = columns.find((f) => f.link?.kind === 'children')!
    expect(links).toMatchObject({ name: 'tags', virtual: true, column: null })
    expect(links.link!.path).toMatchObject({
      table: 'article_tags',
      fk: 'article',
      target: 'tag',
      target_table: 'tags',
    })
    expect(children).toMatchObject({ name: 'corrections', virtual: true })
    expect(children.link!.path).toMatchObject({ table: 'corrections', fk: 'article' })
    // Neither is a column of the grid; both may be asked about in a filter.
    expect(links.views.list).toBe('hide')
    expect(links.type.operators).toEqual(['has_any', 'has_none', 'has_all'])
    // A join table is a table like any other, and its keys are relations.
    expect((await columnsOf('article_tags')).filter((f) => f.relation).map((f) => f.name)).toEqual([
      'article',
      'tag',
    ])
  })
  test('the search and the conditions follow a relation by the name on the other side', async () => {
    const reaches = reachesOf(held, await columnsOf('articles'))
    expect(reaches.section).toMatchObject({ kind: 'column', table: 'sections', label: 'name' })
    expect(reaches.tags).toMatchObject({ kind: 'rows', table: 'article_tags', label: 'name' })
  })
})

describe('the design system, as the build holds it', () => {
  test('no colour, size or shadow is written where it is used: each is a token of DESIGN.md', () => {
    const written = files(source)
      .filter((file) => /\.tsx?$/.test(file) && !/(theme|tokens)\.ts$/.test(file))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .filter(
            (line) =>
              /#[0-9a-f]{3,8}\b|\brgba?\(\s*\d|\b\d+(\.\d+)?px\b|fontSize:|fontWeight:|boxShadow: '[^n]/i.test(
                line
              ) &&
              !/^\s*(\/\/|\*|\/\*)/.test(line) &&
              !line.includes('#[0-9a-f]')
          )
          .map((line) => `${file.slice(source.length + 1)}: ${line.trim()}`)
      )
    expect(written).toEqual([])
  })
  test('the palette is the sixteen pinned families, and a colour outside it is drawn as the nearest', () => {
    expect(Object.keys(palette).length).toBe(16)
    expect(familyOf('steel')).toBe('steel')
    expect(familyOf('#5379a0')).toBe('steel')
    expect(familyOf('salmon')).toBe(null)
    expect(tone('orange')).toMatchObject({ fill: '#f15a2b', text: '#ad401e' })
  })
})

describe('the browser surface', () => {
  const policy = (inPage: boolean) =>
    headersFile(
      {
        ...defaultRuntimeConfig,
        issuer: 'https://idp.example.com',
        relay: 'wss://api.example.com/pg',
      },
      inPage
    )
  test('the published site runs its own scripts alone and reaches the issuer and the relay, nothing else', () => {
    const headers = policy(false)
    expect(headers).toContain(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; connect-src 'self' https://idp.example.com wss://api.example.com; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    )
    expect(headers).not.toContain('eval')
    expect(headers).toContain('X-Content-Type-Options: nosniff')
    expect(headers).toContain('Referrer-Policy: no-referrer')
  })
  test('only the dev mode, whose PostgreSQL is WebAssembly, may compile it', () => {
    expect(policy(true)).toContain("script-src 'self' 'wasm-unsafe-eval';")
  })
  test('nothing is kept outside memory: no localStorage, no cookie, and a store of memory', () => {
    const all = files(source)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')
    expect(all).not.toMatch(/localStorage|document\.cookie/)
    expect(all).toContain('store={memoryStore()}')
    expect(all).toContain('disableTelemetry')
  })
})
