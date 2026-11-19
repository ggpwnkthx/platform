import { describe, expect, test } from 'bun:test'
import { render } from 'preact-render-to-string'
import { familyOf, palette } from '../src/metadata/color.ts'
import { ColourPicker, IconPicker } from '../src/metadata/editors/pickers.tsx'
import { itemIcons } from '../src/ui/icons.tsx'

/**
 * An icon and a colour are picked, not typed: by an item for its own mark, and by the owner
 * of a field for a renderer that takes one as an option. Both are given the same pickers.
 */
const nothing = () => {}

describe('The icon picker', () => {
  test('offers every icon of the platform’s set, and none at all', () => {
    const html = render(
      <IconPicker name="icon" value="" disabled={false} noneTitle="No icon" onChoose={nothing} />
    )
    expect(html.split('type="radio"').length - 1).toBe(Object.keys(itemIcons).length + 1)
    for (const name of Object.keys(itemIcons)) expect(html).toContain(`value="${name}"`)
    expect(html).toContain('title="No icon"')
  })

  test('marks the icon that is chosen, and only that one', () => {
    const html = render(
      <IconPicker
        name="icon"
        value="star"
        disabled={false}
        noneTitle="No icon"
        onChoose={nothing}
      />
    )
    expect(html.split('is-chosen').length - 1).toBe(1)
    expect(html).toMatch(/class="icon-choice is-chosen" title="star"/)
  })

  test('a reader who may not change it is offered nothing to change', () => {
    const html = render(
      <IconPicker name="icon" value="star" disabled noneTitle="No icon" onChoose={nothing} />
    )
    expect(html.split(' disabled').length - 1).toBe(Object.keys(itemIcons).length + 1)
  })
})

describe('The colour picker', () => {
  test('offers every family of the palette, and no colour at all', () => {
    const html = render(
      <ColourPicker name="colour" chosen={null} disabled={false} onChoose={nothing} />
    )
    expect(html.split('type="radio"').length - 1).toBe(palette.length + 1)
    for (const family of palette) expect(html).toContain(`swatch-${family.name}`)
    expect(html).toMatch(/class="swatch swatch-none is-chosen"/)
  })

  test('marks the family that is chosen, and only that one', () => {
    const html = render(
      <ColourPicker name="colour" chosen={familyOf('steel')} disabled={false} onChoose={nothing} />
    )
    expect(html.split('is-chosen').length - 1).toBe(1)
    expect(html).toMatch(/class="swatch swatch-steel is-chosen"/)
  })
})
