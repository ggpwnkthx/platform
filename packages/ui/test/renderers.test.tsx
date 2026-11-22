import { describe, expect, test } from 'bun:test'
import { parseRenderers } from '@platform/vocabulary'
import {
  appliesTo,
  knownRenderers,
  registerRenderer,
  rendererNamed,
  renderersFor,
  resolveRenderer,
} from '../src/fields/renderers/renderers.tsx'

/**
 * The renderers the platform holds.
 */

describe('The renderers the platform holds', () => {
  test('there is a renderer that draws every value', () => {
    const fallback = resolveRenderer('text', 'list', undefined)
    expect(fallback.name).toBe('default')
  })

  test('the renderer a field names is the one that draws its values', () => {
    const renderers = parseRenderers({ list: 'truncate' })
    expect(resolveRenderer('text', 'list', renderers).name).toBe('truncate')
    // The saying is of one situation: the record is drawn as the platform draws it.
    expect(resolveRenderer('text', 'record', renderers).name).toBe('default')
  })

  test('a renderer that does not exist draws nothing', () => {
    const renderers = parseRenderers({ list: 'no-such-renderer' })
    expect(resolveRenderer('text', 'list', renderers).name).toBe('default')
  })

  test('a renderer that does not fit the kind of value draws nothing', () => {
    const renderers = parseRenderers({ list: 'bar' })
    // A bar is of a number: a text is drawn as the platform draws it.
    expect(resolveRenderer('text', 'list', renderers).name).toBe('default')
    expect(resolveRenderer('number', 'list', renderers).name).toBe('bar')
  })

  test('the renderers offered are the ones that fit the kind of value', () => {
    const numbers = renderersFor('number', 'list').map((one) => one.name)
    expect(numbers).toContain('bar')
    expect(numbers).not.toContain('json')
    const texts = renderersFor('text', 'list').map((one) => one.name)
    expect(texts).toContain('link')
    expect(texts).not.toContain('bar')
  })

  test('a renderer of the installation’s own may be added', () => {
    registerRenderer({
      name: 'shout',
      label: 'In capitals',
      kinds: ['text'],
      situations: [],
      render: () => null,
    })
    expect(rendererNamed('shout')).not.toBeNull()
    expect(knownRenderers().map((one) => one.name)).toContain('shout')
    const renderers = parseRenderers({ list: 'shout' })
    expect(resolveRenderer('text', 'list', renderers).name).toBe('shout')
  })

  test('a renderer draws only where it may', () => {
    const paragraph = rendererNamed('paragraph')!
    expect(appliesTo(paragraph, 'text', 'record')).toBe(true)
    // A paragraph is of a value that has paragraphs: not of a number.
    expect(appliesTo(paragraph, 'number', 'record')).toBe(false)
  })
})
