import { Badge, Code, Text } from '@mantine/core'
import type { ReactNode } from 'react'

export const textOf = (value: unknown): string =>
  value === null || value === undefined
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)
export const numberOf = (value: unknown): number | null =>
  value === null || value === '' || Number.isNaN(Number(value)) ? null : Number(value)
export const grouped = (value: unknown) => {
  const n = numberOf(value)
  return n === null
    ? textOf(value)
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 }).format(n)
}
export const minute = (value: unknown) =>
  textOf(value).replace(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}).*$/, '$1 $2')
export const Mono = ({ children, title }: { children: ReactNode; title?: string }) => (
  <span className="mono" title={title}>
    {children}
  </span>
)
export const Clipped = ({ text, length = 60 }: { text: string; length?: number }) => (
  <span title={text}>{text.length > length ? `${text.slice(0, length)}…` : text}</span>
)

/** A listed value's colour follows what the word means, never its place in the list. */
const meanings: [RegExp, string][] = [
  [
    /^(published|active|paid|done|won|approved|complete|completed|customer|closed[ _-]won)$/,
    'green',
  ],
  [
    /^(lost|rejected|closed|blocked|cancelled|canceled|failed|archived|churned|closed[ _-]lost)$/,
    'red',
  ],
  [/^(review|negotiat\w*|partner|in[ _-]progress|qualified|proposal)$/, 'yellow'],
  [/^(draft|new|pending|lead|prospect|open)$/, 'gray'],
]
export const Choice = ({ value }: { value: unknown }) => (
  <Badge
    variant="light"
    radius="xl"
    tt="none"
    color={meanings.find(([word]) => word.test(textOf(value).toLowerCase()))?.[1] ?? 'blue'}
  >
    {textOf(value)}
  </Badge>
)
/** A document, drawn as one. */
export const Document = ({ value }: { value: unknown }) => (
  <Code block>{JSON.stringify(value, null, 2)}</Code>
)
/** A value in the record form: its own text, kept as it was typed. */
export const Paragraph = ({ value }: { value: unknown }) => (
  <Text style={{ whiteSpace: 'pre-wrap' }}>{textOf(value)}</Text>
)
