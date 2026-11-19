import { describe, expect, test } from 'bun:test'
import { rendererNamed, renderersFor } from '@platform/ui/fields/renderers.tsx'
import type { RenderValue } from '@platform/ui/fields/types.ts'
import '../extensions.tsx'

/**
 * The newsroom's own renderers are registered with the registry the interface reads, so
 * they are offered beside the platform's own for the kinds of value they draw.
 */
const drawn = (name: string, value: unknown, options: Record<string, unknown> = {}) =>
  JSON.stringify(
    rendererNamed(name)!.render({ value, options, situation: 'record' } as unknown as RenderValue)
  )

describe('the renderers of the newsroom’s own', () => {
  test('each is offered for the kind of value it draws', () => {
    const texts = renderersFor('text', 'list').map((one) => one.name)
    expect(texts).toEqual(expect.arrayContaining(['icon', 'colour', 'marked']))
    expect(texts).not.toContain('reading-time')
    const integers = renderersFor('integer', 'list').map((one) => one.name)
    expect(integers).toEqual(expect.arrayContaining(['reading-time', 'marked']))
    expect(integers).not.toContain('icon')
    expect(integers).not.toContain('colour')
  })

  test('an icon and a colour are options that are picked, not typed', () => {
    expect(rendererNamed('marked')!.options?.map((one) => one.type)).toEqual(['icon', 'colour'])
  })

  test('a colour is drawn as the family it belongs to, and a text that is none as itself', () => {
    expect(drawn('colour', 'steel')).toContain('tone-steel')
    expect(drawn('colour', '#5379a3')).toContain('tone-steel')
    expect(drawn('colour', 'nonsense')).not.toContain('tone-steel')
    expect(drawn('colour', 'nonsense')).toContain('"children":"nonsense"')
  })

  test('a name the icon set does not hold is drawn as the text it is', () => {
    expect(drawn('icon', 'no-such-icon')).toContain('"children":"no-such-icon"')
    expect(drawn('icon', 'star')).not.toContain('"children":"star"')
  })

  test('a value is marked with the colour its owner picked, or with none', () => {
    expect(drawn('marked', 'Politics', { icon: 'newspaper', colour: 'cyan' })).toContain(
      'tone-cyan'
    )
    expect(drawn('marked', 'Politics')).toContain('"class":""')
  })
})
