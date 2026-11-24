import { LinearProgress, Link } from '@mui/material'
import type { Kind } from '@platform/core'
import { useRecordContext } from 'react-admin'
import type { ReactNode } from 'react'
import tokens from 'virtual:design-tokens'
import type { DrawProps, Field, Situation } from './types.ts'
import { Choice, Clipped, Document, grouped, Mono, numberOf, Paragraph, textOf } from './values.tsx'

/**
 * A renderer draws a value its own way, in one situation, where a field's owner asks for it.
 * A site registers its own beside these, through `@platform/ui/extensions`.
 */
export interface RendererOption {
  name: string
  label: string
  type: 'text' | 'number' | 'icon' | 'colour'
  placeholder?: string
}
export interface Renderer {
  name: string
  label: string
  /** The kinds of field it draws; none means any. */
  kinds: Kind[]
  options?: RendererOption[]
  render(props: DrawProps): ReactNode
}
const renderers = new Map<string, Renderer>()
export const registerRenderer = (renderer: Renderer) => void renderers.set(renderer.name, renderer)
export const renderersFor = (field: Field) =>
  [...renderers.values()].filter((r) => !r.kinds.length || r.kinds.includes(field.kind))
const filled = (template: unknown, value: unknown, fallback: string) =>
  (typeof template === 'string' && template ? template : fallback).replaceAll(
    '{value}',
    textOf(value)
  )
const numbers: Kind[] = ['integer', 'number']
const any: Kind[] = []

const platformRenderers: Renderer[] = [
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
  { name: 'paragraph', label: 'The text, as it was typed', kinds: ['text'], render: Paragraph },
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
    render: ({ value }) => (value ? 'Yes' : 'No'),
  },
  { name: 'json', label: 'The document, as a document', kinds: ['json'], render: Document },
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
      if (!/^(https?:|mailto:)/i.test(href)) return textOf(value)
      return (
        <Link href={href} target="_blank" rel="noreferrer">
          {textOf(value)}
        </Link>
      )
    },
  },
  {
    name: 'template',
    label: 'The value, in a text of your own',
    kinds: any,
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
      <LinearProgress
        variant="determinate"
        title={textOf(value)}
        value={Math.min(100, ((numberOf(value) ?? 0) / (numberOf(options.max) || 100)) * 100)}
        sx={{ minWidth: tokens.layout['module-bar'] }}
      />
    ),
  },
  {
    name: 'raw',
    label: 'The value, as PostgreSQL wrote it',
    kinds: any,
    render: ({ value }) => <Mono>{textOf(value)}</Mono>,
  },
]
for (const renderer of platformRenderers) registerRenderer(renderer)

/** A value as its field draws it in a situation: its renderer where one is said, its type otherwise. */
export function Value({ field, situation }: { field: Field; situation: Situation }) {
  const value = useRecordContext()?.[field.name]
  if ((value === null || value === undefined) && !field.virtual)
    return (
      <Mono>
        <span data-null>null</span>
      </Mono>
    )
  const choice = field.renderers[situation]
  const renderer = choice && renderersFor(field).find((r) => r.name === choice.renderer)
  const props: DrawProps = { value, field, situation, options: choice?.options ?? {} }
  return <>{renderer ? renderer.render(props) : field.type.draw(props)}</>
}
