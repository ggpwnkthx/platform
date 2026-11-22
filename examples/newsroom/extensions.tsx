import { Badge, Group } from '@mantine/core'
import {
  grouped,
  isIcon,
  ItemIcon,
  numberOf,
  registerRenderer,
  textOf,
  tone,
} from '@platform/ui/extensions'

/**
 * The newsroom's own renderers.
 *
 * The example's platform.json names this module as its extensions, so every build of the
 * folder imports it before any page draws a field, and what it registers is offered in the
 * field's drawer beside the platform's renderers.
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
    if (words === null) return <span className="mono">{String(value)}</span>
    const pace = numberOf(options.pace) || defaultPace
    return (
      <span title={`${grouped(value)} words`}>
        {Math.max(1, Math.round(words / pace))} min read
      </span>
    )
  },
})

/** A text that names an icon of the set — `star`, `newspaper` — as the icon it names. */
registerRenderer({
  name: 'icon',
  label: 'As the icon it names',
  kinds: ['text'],
  render: ({ value, situation }) => {
    const name = textOf(value).trim()
    if (!isIcon(name)) return name
    // The grid is narrow: the glyph alone, with its name in a hint. Elsewhere, both.
    return (
      <Group gap={6} wrap="nowrap" title={name}>
        <ItemIcon name={name} />
        {situation !== 'list' && name}
      </Group>
    )
  },
})

/** A text that names a colour — a family of the palette, or #rrggbb — as a swatch of its family. */
registerRenderer({
  name: 'colour',
  label: 'As the colour it names',
  kinds: ['text'],
  render: ({ value }) => {
    const drawn = tone(value)
    if (!drawn) return textOf(value)
    return (
      <Group gap={6} wrap="nowrap">
        <span
          aria-hidden
          style={{ width: 14, height: 14, borderRadius: 4, background: drawn.fill }}
        />
        {textOf(value)}
      </Group>
    )
  },
})

/** Any value, marked with an icon and a colour its owner picked in the field's drawer. */
registerRenderer({
  name: 'marked',
  label: 'With an icon and a colour you pick',
  kinds: [],
  options: [
    { name: 'icon', label: 'The icon beside the value', type: 'icon' },
    { name: 'colour', label: 'The colour it is drawn in', type: 'colour' },
  ],
  render: ({ value, options }) => {
    const drawn = tone(options.colour)
    return (
      <Badge
        radius="xl"
        tt="none"
        fw={500}
        color={drawn?.fill ?? 'gray'}
        c={drawn?.ink}
        variant={drawn ? 'filled' : 'light'}
        leftSection={isIcon(options.icon) ? <ItemIcon name={options.icon} size={13} /> : undefined}
      >
        {textOf(value)}
      </Badge>
    )
  },
})
