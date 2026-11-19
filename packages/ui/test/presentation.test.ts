import { describe, expect, test } from 'bun:test'
import {
  collectionTarget,
  fieldTarget,
  metadataStatements,
  workspaceTarget,
} from '../src/db/metadata.ts'
import { familyOf, palette, parseColor, reservedFamilies, toneClass } from '../src/state/color.ts'
import { indexPresentations, presentationOf } from '../src/state/presentation.ts'
import { itemIcons, iconFor } from '../src/ui/icons.tsx'

describe('The colour of an item', () => {
  test('a colour is written as the platform understands it', () => {
    expect(parseColor('#449fd8')).toBe('#449fd8')
    expect(parseColor('#ABC')).toBe('#aabbcc')
    expect(parseColor('steel')).toBeNull()
    expect(parseColor(42)).toBeNull()
  })

  test('a family is named by its name', () => {
    expect(familyOf('steel')?.hex).toBe('#5379a3')
    expect(familyOf('STEEL')?.hex).toBe('#5379a3')
  })

  test('a colour of the palette is the family it is', () => {
    expect(familyOf('#5379a3')?.name).toBe('steel')
  })

  test('a colour the palette does not hold is drawn as the nearest family', () => {
    expect(familyOf('#5480a4')?.name).toBe('steel')
    expect(familyOf('#ff0000')?.name).toBe('red')
  })

  test('nothing at all is no family', () => {
    expect(familyOf('')).toBeNull()
    expect(familyOf(null)).toBeNull()
    expect(familyOf('not a colour')).toBeNull()
  })

  test('a family is drawn with its own class', () => {
    expect(toneClass('steel')).toBe('tone-steel')
    expect(toneClass('#5379a3')).toBe('tone-steel')
    expect(toneClass('')).toBe('')
    expect(toneClass(null)).toBe('')
  })

  test("the palette keeps its reserved families apart from the studio's own", () => {
    expect(reservedFamilies.map((one) => one.name)).not.toContain('orange')
    expect(reservedFamilies).toHaveLength(palette.length - 5)
    expect(new Set(palette.map((one) => one.hex)).size).toBe(palette.length)
  })
})

describe('The icon of an item', () => {
  test("a named icon is the platform's own", () => {
    expect(iconFor('newspaper')).toBe(itemIcons.newspaper!)
  })

  test('an icon the platform does not draw is no icon', () => {
    expect(iconFor('not-an-icon')).toBeNull()
    expect(iconFor('')).toBeNull()
    expect(iconFor(null)).toBeNull()
  })
})

describe('The presentation of an item', () => {
  const rows = [
    {
      scope: 'workspace' as const,
      schema_name: 'newsroom',
      table_name: null,
      column_name: null,
      key: 'display_name',
      value: 'Newsroom',
    },
    {
      scope: 'workspace' as const,
      schema_name: 'newsroom',
      table_name: null,
      column_name: null,
      key: 'icon',
      value: 'newspaper',
    },
    {
      scope: 'workspace' as const,
      schema_name: 'newsroom',
      table_name: null,
      column_name: null,
      key: 'color',
      value: 'steel',
    },
    {
      scope: 'collection' as const,
      schema_name: 'newsroom',
      table_name: 'articles',
      column_name: null,
      key: 'display_name',
      value: 'Articles',
    },
    {
      scope: 'field' as const,
      schema_name: 'newsroom',
      table_name: 'articles',
      column_name: 'title',
      key: 'display_name',
      value: 'Headline',
    },
  ]

  test('every presentation is filed by the item it names', () => {
    const index = indexPresentations(rows)
    expect(presentationOf(index, 'newsroom').displayName).toBe('Newsroom')
    expect(presentationOf(index, 'newsroom', 'articles').displayName).toBe('Articles')
    expect(presentationOf(index, 'newsroom', 'articles', 'title').displayName).toBe('Headline')
    expect(presentationOf(index, 'crm')).toEqual({
      displayName: null,
      icon: null,
      color: null,
    })
  })

  test('a value that is not text is no name', () => {
    const index = indexPresentations([
      {
        scope: 'workspace',
        schema_name: 'newsroom',
        table_name: null,
        column_name: null,
        key: 'display_name',
        value: { name: 'Newsroom' },
      },
      {
        scope: 'workspace',
        schema_name: 'newsroom',
        table_name: null,
        column_name: null,
        key: 'icon',
        value: '  ',
      },
    ])
    const found = presentationOf(index, 'newsroom')
    expect(found.displayName).toBeNull()
    expect(found.icon).toBeNull()
  })
})

describe('The statements that write a presentation', () => {
  test('a key is written with the value it holds', () => {
    const [set] = metadataStatements(workspaceTarget('newsroom'), [
      { key: 'display_name', value: 'Newsroom' },
    ])
    expect(set).toContain("'workspace'")
    expect(set).toContain("'display_name'")
    expect(set).toContain('"Newsroom"')
    expect(set).toContain('ON CONFLICT')
  })

  test('a collection names its table', () => {
    const [set] = metadataStatements(collectionTarget('newsroom', 'articles'), [
      { key: 'icon', value: 'file-text' },
    ])
    expect(set).toContain("'collection'")
    expect(set).toContain("'articles'")
  })

  test('a field names its column', () => {
    const [set] = metadataStatements(fieldTarget('newsroom', 'articles', 'title'), [
      { key: 'display_name', value: 'Headline' },
    ])
    expect(set).toContain("'field'")
    expect(set).toContain("'articles'")
    expect(set).toContain("'title'")
    expect(set).toContain('column_name')
  })

  test('a key that is cleared is removed', () => {
    const [remove] = metadataStatements(collectionTarget('newsroom', 'articles'), [
      { key: 'icon', value: null },
    ])
    expect(remove).toContain('DELETE FROM platform.item_metadata')
    expect(remove).toContain("'icon'")
  })

  test('a value with a quote in it is written as a literal', () => {
    const [set] = metadataStatements(workspaceTarget('newsroom'), [
      { key: 'display_name', value: "O'Brien's desk" },
    ])
    expect(set).toContain("O''Brien")
  })
})
