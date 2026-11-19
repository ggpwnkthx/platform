import { describe, expect, test } from 'bun:test'
import type { ColumnInfo } from '@platform/data'
import { metadataFilter, metadataStart, metadataTargetOf } from '@platform/data'
import {
  collectionTarget,
  fieldTarget,
  presentationKeys,
  renderersKey,
  viewsKey,
  workspaceTarget,
} from '@platform/vocabulary'
import { fieldText, fieldValue } from '../src/fields/edit.ts'
import { describeField } from '../src/fields/resolve.ts'
import {
  hasKeyEditor,
  keyEditorOf,
  keyEditorsFor,
  knownKeyEditors,
  registerMetadataKeyEditor,
} from '../src/metadata/registry.ts'

/**
 * Metadata is a system collection. What is its own is small: the item a row is about, which
 * is named and not pointed at; the value, which is typed as it is meant; and the editors of
 * the keys the interface reads for itself.
 */
const column = (table: string, name: string, type: string): ColumnInfo => ({
  schema: 'newsroom',
  table,
  name,
  position: 1,
  type,
  required: true,
  default: null,
  comment: null,
  generated: null,
  identity: null,
  can_select: true,
  can_insert: true,
  can_update: true,
})

describe('The item a row of metadata is about', () => {
  test('the rows of an item are the ones a filter on its names lets through', () => {
    // A row does not name its workspace: it is in it.
    expect(metadataFilter(workspaceTarget('newsroom'))).toEqual({
      scope: { op: 'eq', value: 'workspace' },
      table_name: { op: 'is_null', value: null },
      column_name: { op: 'is_null', value: null },
    })
    expect(metadataFilter(fieldTarget('newsroom', 'articles', 'title')).column_name).toEqual({
      op: 'eq',
      value: 'title',
    })
  })

  test('a new row about an item starts with the names of the item', () => {
    expect(metadataStart(workspaceTarget('newsroom'))).toEqual({ scope: 'workspace' })
    expect(metadataStart(fieldTarget('newsroom', 'articles', 'title'))).toEqual({
      scope: 'field',
      table_name: 'articles',
      column_name: 'title',
    })
  })

  test('the item is the workspace a row was read in, and the names the row carries', () => {
    expect(metadataTargetOf('newsroom', { scope: 'collection', table_name: 'articles' })).toEqual(
      collectionTarget('newsroom', 'articles')
    )
    expect(
      metadataTargetOf('newsroom', metadataStart(fieldTarget('newsroom', 'articles', 'title')))
    ).toEqual(fieldTarget('newsroom', 'articles', 'title'))
    expect(metadataTargetOf('crm', { scope: 'workspace' })).toEqual(workspaceTarget('crm'))
  })

  test('a row that names no item the platform knows is about nothing', () => {
    expect(metadataTargetOf('newsroom', null)).toBeNull()
    expect(metadataTargetOf('', { scope: 'workspace' })).toBeNull()
    expect(metadataTargetOf('newsroom', { scope: 'galaxy' })).toBeNull()
    expect(metadataTargetOf('newsroom', { scope: 'collection' })).toBeNull()
    expect(metadataTargetOf('newsroom', { scope: 'workspace', table_name: 'articles' })).toBeNull()
  })
})

describe('The value of a piece of metadata', () => {
  const value = describeField(column('item_metadata', 'value', 'jsonb'))

  test('is a field type of its own, of that one column', () => {
    expect(value.type.name).toBe('metadata-value')
    // Another JSON column, of the same collection or of another, is a JSON column.
    expect(describeField(column('item_metadata', 'other', 'jsonb')).type.name).toBe('json')
    expect(describeField(column('articles', 'value', 'jsonb')).type.name).toBe('json')
  })

  test('a sentence is kept as a string, and JSON as itself', () => {
    expect(fieldValue(value, 'The newsroom')).toEqual({ value: '"The newsroom"' })
    expect(fieldValue(value, '{"drafts_days": 90}')).toEqual({ value: '{"drafts_days":90}' })
    expect(fieldValue(value, '42')).toEqual({ value: '42' })
    expect(fieldValue(value, 'true')).toEqual({ value: 'true' })
    // What only looks like JSON is still a sentence.
    expect(fieldValue(value, '{not json')).toEqual({ value: '"{not json"' })
  })

  test('the form holds a string as itself, and anything else as JSON', () => {
    expect(fieldText(value, 'The newsroom')).toBe('The newsroom')
    expect(fieldText(value, { drafts_days: 90 })).toBe('{\n  "drafts_days": 90\n}')
  })
})

describe('The key editors', () => {
  test('every key the interface reads for itself has one', () => {
    for (const key of presentationKeys)
      for (const scope of ['workspace', 'collection', 'field'] as const)
        expect(keyEditorOf(scope, key)?.name).toBe('presentation')
    expect(keyEditorOf('field', viewsKey)?.name).toBe('views')
    expect(keyEditorOf('field', renderersKey)?.name).toBe('renderers')
  })

  test('an editor is of the kinds of item it says, and of no other', () => {
    expect(keyEditorsFor('field').map((one) => one.name)).toEqual([
      'presentation',
      'views',
      'renderers',
    ])
    expect(keyEditorsFor('workspace').map((one) => one.name)).toEqual(['presentation'])
    expect(hasKeyEditor('collection', viewsKey)).toBe(false)
  })

  test('a key with no editor is a row like any other', () => {
    expect(hasKeyEditor('workspace', 'purpose')).toBe(false)
    expect(keyEditorOf('collection', 'retention')).toBeNull()
  })

  test('an installation may add an editor for a key of its own', () => {
    registerMetadataKeyEditor({
      name: 'retention',
      title: 'Retention',
      keys: ['retention'],
      scopes: ['collection'],
      Editor: () => null,
    })
    expect(keyEditorOf('collection', 'retention')?.name).toBe('retention')
    expect(hasKeyEditor('workspace', 'retention')).toBe(false)
    expect(knownKeyEditors().map((one) => one.name)).toContain('retention')
  })
})
