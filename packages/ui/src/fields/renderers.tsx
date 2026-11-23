import { Anchor, Progress, Text } from '@mantine/core'
import type { Kind } from '@platform/core'
import type { ReactNode } from 'react'
import type { Field, DrawProps } from './types.ts'
import { Choice, Clipped, Document, grouped, Mono, numberOf, Paragraph, textOf } from './values.tsx'

export interface RendererOption {
  name: string
  label: string
  type: 'text' | 'number' | 'icon' | 'colour'
  placeholder?: string
}
export interface Renderer {
  name: string
  label: string
  /** The kinds of value it fits; none means every kind. */
  kinds: Kind[]
  options?: RendererOption[]
  render(props: DrawProps): ReactNode
}
const renderers = new Map<string, Renderer>()
/** Adds a renderer: one of the platform's, or one of the installation's own, from its extensions. */
export const registerRenderer = (renderer: Renderer) => void renderers.set(renderer.name, renderer)
export const renderersFor = (field: Field) =>
  [...renderers.values()].filter((r) => !r.kinds.length || r.kinds.includes(field.kind))
const filled = (template: unknown, value: unknown, fallback: string) =>
  (typeof template === 'string' && template ? template : fallback).replaceAll(
    '{value}',
    textOf(value)
  )
const numbers: Kind[] = ['integer', 'number']

/** The renderers the platform offers: a value drawn each of the ways it is worth drawing. */
export const platformRenderers: Renderer[] = [
  {
    name: 'text',
    label: 'The text, in full',
    kinds: ['text'],
    render: ({ value }) => textOf(value),
  },
  {
    name: 'truncate',
    label: 'The text, shortened',
    kinds: ['text'],
    options: [{ name: 'length', label: 'Characters to keep', type: 'number', placeholder: '20' }],
    render: ({ value, options }) => (
      <Clipped text={textOf(value)} length={numberOf(options.length) ?? 20} />
    ),
  },
  {
    name: 'paragraph',
    label: 'The text, as it was typed',
    kinds: ['text'],
    render: ({ value }) => <Paragraph value={value} />,
  },
  {
    name: 'number',
    label: 'The number, with its thousands marked',
    kinds: numbers,
    render: ({ value }) => <Mono>{grouped(value)}</Mono>,
  },
  {
    name: 'boolean',
    label: 'Yes or no, in words',
    kinds: ['boolean'],
    render: ({ value }) => (value === null ? '' : value ? 'Yes' : 'No'),
  },
  {
    name: 'moment',
    label: 'The whole moment',
    kinds: ['moment', 'date', 'time'],
    render: ({ value }) => <Mono>{textOf(value)}</Mono>,
  },
  {
    name: 'uuid',
    label: 'The whole uuid',
    kinds: ['uuid'],
    render: ({ value }) => <Mono>{textOf(value)}</Mono>,
  },
  {
    name: 'json',
    label: 'The document, as a document',
    kinds: ['json'],
    render: ({ value }) => <Document value={value} />,
  },
  { name: 'choice', label: 'The value, as the choice it is', kinds: ['text'], render: Choice },
  {
    name: 'link',
    label: 'The text, as a link',
    kinds: ['text'],
    options: [
      {
        name: 'href',
        label: 'The address, with {value} in it',
        type: 'text',
        placeholder: 'https://example.com/{value}',
      },
    ],
    render({ value, options }) {
      const href = filled(options.href, value, '{value}')
      // A value is never trusted to be an address: only http(s) and mailto are links.
      return /^(https?:|mailto:)/i.test(href) ? (
        <Anchor href={href} target="_blank" rel="noreferrer">
          {textOf(value)}
        </Anchor>
      ) : (
        textOf(value)
      )
    },
  },
  {
    name: 'template',
    label: 'The value, in a text of your own',
    kinds: [],
    options: [
      {
        name: 'template',
        label: 'The text, with {value} in it',
        type: 'text',
        placeholder: '» {value}',
      },
    ],
    render: ({ value, options }) => filled(options.template, value, '{value}'),
  },
  {
    name: 'bar',
    label: 'The number, as a bar of a whole',
    kinds: numbers,
    options: [{ name: 'max', label: 'The whole', type: 'number', placeholder: '100' }],
    render: ({ value, options }) => (
      <Progress
        value={((numberOf(value) ?? 0) / (numberOf(options.max) || 100)) * 100}
        title={textOf(value)}
        miw={80}
      />
    ),
  },
  {
    name: 'raw',
    label: 'The value, as PostgreSQL wrote it',
    kinds: [],
    render: ({ value }) => <Mono>{textOf(value)}</Mono>,
  },
]

for (const renderer of platformRenderers) registerRenderer(renderer)

/**
 * A value, drawn where it is. The field's own saying picks the renderer for the situation; one
 * the platform does not hold, or that does not fit the kind of value, draws nothing, and the
 * field's type draws the value its own way.
 */
export function Value({
  field,
  value,
  situation,
  label,
}: {
  field: Field
  value: unknown
  situation: 'list' | 'record' | 'filter'
  label?: string
}) {
  if (value === null || value === undefined)
    return (
      <Text span c="dimmed" className="mono">
        null
      </Text>
    )
  const choice = field.renderers[situation]
  const renderer = choice && renderersFor(field).find((r) => r.name === choice.renderer)
  const props: DrawProps = { value, field, situation, options: choice?.options ?? {}, label }
  return (
    <>
      {renderer
        ? renderer.render(props)
        : field.type.draw[situation === 'list' ? 'list' : 'record'](props)}
    </>
  )
}
