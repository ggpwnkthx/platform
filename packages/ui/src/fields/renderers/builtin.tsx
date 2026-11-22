import {
  drawBar,
  drawBoolean,
  drawChoice,
  drawDefault,
  drawJson,
  drawLink,
  drawMoment,
  drawNumber,
  drawParagraph,
  drawRaw,
  drawTemplate,
  drawText,
  drawTruncate,
  drawUuid,
} from './draw.tsx'
import { registerRenderer } from './registry.ts'

/* The renderers the platform holds. */
registerRenderer({
  name: 'default',
  label: 'As the platform draws it',
  kinds: [],
  situations: [],
  render: drawDefault,
})
registerRenderer({
  name: 'text',
  label: 'The text, in full',
  kinds: ['text', 'other'],
  situations: [],
  render: drawText,
})
registerRenderer({
  name: 'truncate',
  label: 'Shortened, with an ellipsis',
  kinds: ['text', 'other'],
  situations: [],
  options: [
    {
      name: 'length',
      label: 'Characters to keep',
      type: 'number',
      placeholder: '40',
    },
  ],
  render: drawTruncate,
})
registerRenderer({
  name: 'paragraph',
  label: 'As a paragraph, as it was typed',
  kinds: ['text', 'other'],
  situations: ['record', 'filter'],
  render: drawParagraph,
})
registerRenderer({
  name: 'number',
  label: 'A number, with the thousands marked',
  kinds: ['integer', 'number'],
  situations: [],
  render: drawNumber,
})
registerRenderer({
  name: 'boolean',
  label: 'Yes or no, in words',
  kinds: ['boolean'],
  situations: [],
  render: drawBoolean,
})
registerRenderer({
  name: 'moment',
  label: 'The whole moment, as the database wrote it',
  kinds: ['moment', 'date', 'time'],
  situations: [],
  render: drawMoment,
})
registerRenderer({
  name: 'uuid',
  label: 'The whole uuid',
  kinds: ['uuid'],
  situations: [],
  render: drawUuid,
})
registerRenderer({
  name: 'json',
  label: 'As a document',
  kinds: ['json'],
  situations: [],
  render: drawJson,
})
registerRenderer({
  name: 'choice',
  label: 'As the choice it is',
  kinds: ['text'],
  situations: [],
  render: drawChoice,
})
registerRenderer({
  name: 'link',
  label: 'As a link',
  kinds: ['text'],
  situations: [],
  options: [
    {
      name: 'href',
      label: 'The address',
      placeholder: 'https://example.com/{value}',
    },
  ],
  render: drawLink,
})
registerRenderer({
  name: 'template',
  label: 'As the owner wrote it',
  kinds: [],
  situations: [],
  options: [
    {
      name: 'template',
      label: 'The text',
      placeholder: 'Due {value}',
    },
  ],
  render: drawTemplate,
})
registerRenderer({
  name: 'bar',
  label: 'As a bar of a whole',
  kinds: ['integer', 'number'],
  situations: [],
  options: [
    {
      name: 'max',
      label: 'The whole',
      type: 'number',
      placeholder: '100',
    },
  ],
  render: drawBar,
})
registerRenderer({
  name: 'raw',
  label: 'As the database wrote it, and nothing more',
  kinds: [],
  situations: [],
  render: drawRaw,
})
