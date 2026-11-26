import { Box, Chip } from '@mui/material'
import {
  grouped,
  isIcon,
  ItemIcon,
  Mono,
  numberOf,
  registerRenderer,
  textOf,
  tone,
} from '@platform/ui/extensions'

/**
 * What the newsroom adds to the interface: renderers of its own, offered beside the
 * platform's wherever a column's owner chooses how it is drawn. A site names this module as
 * `extensions` in its platform.json, and every build of the folder carries it.
 */
const defaultPace = 230
const beside = { display: 'inline-flex', alignItems: 'center', gap: 1.5 }

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
    if (words === null) return <Mono>{String(value)}</Mono>
    const pace = numberOf(options.pace) || defaultPace
    return (
      <span title={`${grouped(value)} words`}>
        {Math.max(1, Math.round(words / pace))} min read
      </span>
    )
  },
})

registerRenderer({
  name: 'icon',
  label: 'As the icon it names',
  kinds: ['text'],
  render: ({ value, situation }) => {
    const name = textOf(value).trim()
    if (!isIcon(name)) return name
    return (
      <Box component="span" sx={beside} title={name}>
        <ItemIcon name={name} />
        {situation !== 'list' && name}
      </Box>
    )
  },
})

registerRenderer({
  name: 'colour',
  label: 'As the colour it names',
  kinds: ['text'],
  render: ({ value }) => {
    const drawn = tone(value)
    if (!drawn) return textOf(value)
    return (
      <Box component="span" sx={beside}>
        <Box
          component="span"
          aria-hidden
          sx={{ width: '1em', height: '1em', borderRadius: 1, bgcolor: drawn.fill }}
        />
        {textOf(value)}
      </Box>
    )
  },
})

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
      <Chip
        label={textOf(value)}
        icon={isIcon(options.icon) ? <ItemIcon name={options.icon} /> : undefined}
        sx={
          drawn
            ? { bgcolor: drawn.fill, color: drawn.ink, '& .MuiChip-icon': { color: 'inherit' } }
            : undefined
        }
      />
    )
  },
})
