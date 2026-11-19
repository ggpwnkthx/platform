import { registerRenderer } from '@platform/ui/fields/renderers.tsx'
import { grouped, numberOf, textOf } from '@platform/ui/fields/text.ts'
import { familyOf, toneClass } from '@platform/ui/metadata/color.ts'
import { iconFor } from '@platform/ui/ui/icons.tsx'

/**
 * The newsroom's own renderers.
 *
 * The example's configuration names this module as its extensions, so the build puts it in
 * the place of the interface's own, which is empty: it is imported before any page draws a
 * field, and what it registers is offered in the editor beside the platform's renderers.
 *
 * A renderer draws; it does not decide. It is given the value PostgreSQL let the reader
 * have, and nothing else.
 */

/** The words a reader gets through in a minute. */
const defaultPace = 230

/** A word count, as the time it takes to read: the newsroom thinks in minutes, not words. */
registerRenderer({
  name: 'reading-time',
  label: 'As the time it takes to read',
  kinds: ['integer'],
  situations: [],
  options: [
    {
      name: 'pace',
      label: 'Words read in a minute',
      type: 'number',
      placeholder: String(defaultPace),
    },
  ],
  render: ({ value, options }) => {
    const words = numberOf(value)
    if (words === null) return <span class="mono">{String(value)}</span>
    const given = Number(options.pace)
    const pace = Number.isFinite(given) && given > 0 ? given : defaultPace
    const minutes = Math.max(1, Math.round(words / pace))
    return (
      <span class="value-text" title={`${grouped(value)} words`}>
        {minutes} min read
      </span>
    )
  },
})

/**
 * A text that names an icon of the platform's set — `star`, `newspaper` — as the icon it
 * names. A name the set does not hold is drawn as the text it is.
 */
registerRenderer({
  name: 'icon',
  label: 'As the icon it names',
  kinds: ['text'],
  situations: [],
  render: ({ value, situation }) => {
    const name = textOf(value).trim()
    const Glyph = iconFor(name)
    if (!Glyph) return <span class="value-text">{name}</span>
    // The grid is narrow: the glyph alone, with its name in a hint. Elsewhere, both.
    if (situation === 'list')
      return (
        <span title={name}>
          <Glyph size={16} aria-label={name} />
        </span>
      )
    return (
      <span class="value-text" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <Glyph size={16} aria-hidden="true" />
        {name}
      </span>
    )
  },
})

/**
 * A text that names a colour — a family of the palette, or a colour written as #rrggbb — as
 * a swatch of the family it belongs to, beside what was written. A text that is no colour is
 * drawn as the text it is.
 */
registerRenderer({
  name: 'colour',
  label: 'As the colour it names',
  kinds: ['text'],
  situations: [],
  render: ({ value }) => {
    const text = textOf(value).trim()
    const family = familyOf(text)
    if (!family) return <span class="value-text">{text}</span>
    return (
      <span
        class={toneClass(text)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
        title={family.name}
      >
        <span
          aria-hidden="true"
          style={{
            width: '14px',
            height: '14px',
            borderRadius: '4px',
            background: 'var(--tone-fill)',
            flex: 'none',
          }}
        />
        {text}
      </span>
    )
  },
})

/**
 * Any value, marked with an icon and a colour its owner picked: the options are picked in
 * the field's drawer, from the platform's own set and its own palette, and not typed.
 */
registerRenderer({
  name: 'marked',
  label: 'With an icon and a colour you pick',
  kinds: [],
  situations: [],
  options: [
    { name: 'icon', label: 'The icon beside the value', type: 'icon' },
    { name: 'colour', label: 'The colour it is drawn in', type: 'colour' },
  ],
  render: ({ value, options }) => {
    const Glyph = iconFor(typeof options.icon === 'string' ? options.icon : null)
    return (
      <span
        class={toneClass(options.colour)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          height: '22px',
          padding: '0 9px',
          borderRadius: '11px',
          fontSize: '12.5px',
          fontWeight: 500,
          background: 'var(--tone-fill, var(--bg-sunk))',
          color: 'var(--tone-ink, var(--text-soft))',
        }}
      >
        {Glyph && <Glyph size={13} aria-hidden="true" />}
        {textOf(value)}
      </span>
    )
  },
})
