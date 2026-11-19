import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fieldSchema, fieldSql } from '../packages/cli/src/model.ts'
import { fieldStatements } from '../packages/ui/src/model/statements.ts'

/**
 * The operator's tools and the interface build the model in their own way — a manifest
 * applied to a database, a collection made in the browser — and they must build it the same
 * way: the same field has to make the same column, or a model made in one and a manifest
 * applied in the other disagree about what exists.
 */
describe('the manifest and the interface make the same column', () => {
  test('a manifest field and a draft of the same field make the same column', async () => {
    const manifest = fieldSchema.parse({
      name: 'title',
      type: 'string',
      required: true,
      options: { max_length: 120 },
    })
    const draft = {
      name: 'title',
      type: 'text' as const,
      required: true,
      unique: false,
      indexed: false,
      default: '',
      note: '',
      maxLength: 120,
    }
    const fromDraft = (await fieldStatements('newsroom', 'articles', draft))[0]!
      .replace('ALTER TABLE "newsroom"."articles" ADD COLUMN ', '')
      .replace(/;$/, '')
    expect(fromDraft).toBe(fieldSql(manifest))
  })
  test('a manifest’s default is the column’s default', () => {
    const manifest = fieldSchema.parse({ name: 'status', type: 'text', default: 'draft' })
    expect(fieldSql(manifest)).toContain(`DEFAULT E'draft'`)
  })
  test('both build their SQL through the shared package', () => {
    const cli = JSON.parse(
      readFileSync(new URL('../packages/cli/package.json', import.meta.url), 'utf8')
    )
    const ui = JSON.parse(
      readFileSync(new URL('../packages/ui/package.json', import.meta.url), 'utf8')
    )
    expect(cli.dependencies['@platform/sql']).toBe('workspace:*')
    expect(ui.dependencies['@platform/sql']).toBe('workspace:*')
  })
})
