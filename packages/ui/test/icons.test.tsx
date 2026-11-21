import { describe, expect, test } from 'bun:test'
import { render } from 'preact-render-to-string'
import { CopyIcon, ListIcon, MoreIcon, OptionsIcon, SaveIcon, SortIcon } from '../src/ui/icons.tsx'

/**
 * The interface's own icons. They are the platform's, not a library's, so that every button
 * that draws one draws the same one; each is an SVG with a name of its own.
 */
describe('The icons the interface draws', () => {
  const icons = { CopyIcon, ListIcon, MoreIcon, OptionsIcon, SaveIcon, SortIcon }

  test('each is drawn as an SVG of the size it was asked for', () => {
    for (const [name, Icon] of Object.entries(icons)) {
      const drawn = render(<Icon size={16} />)
      expect(drawn).toContain('<svg')
      expect(drawn).toContain('width="16"')
      expect(name).toMatch(/Icon$/)
    }
  })

  test('each says what it is for, so that it is read by the name it has', () => {
    expect(render(<CopyIcon size={16} aria-label="Copy" />)).toContain('aria-label="Copy"')
    expect(render(<SortIcon size={16} aria-label="Sort" />)).toContain('aria-label="Sort"')
  })
})
