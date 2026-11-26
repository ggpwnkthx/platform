import { Box, Chip } from '@mui/material'
import tokens from 'virtual:design-tokens'
import { Mono } from '../kit/marks.tsx'

/** How values are said: as text, as numbers, clipped, and as the choice a word is. */
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
/** A moment, to the minute. */
export const minute = (value: unknown) =>
  textOf(value).replace(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}).*$/, '$1 $2')
export const Clipped = ({ text, length = 60 }: { text: string; length?: number }) => (
  <span title={text}>{text.length > length ? `${text.slice(0, length)}…` : text}</span>
)

/** A listed value's tone follows what the word means, not its place in the list. */
const meanings: [RegExp, 'success' | 'error' | 'warning' | undefined][] = [
  [
    /^(published|active|paid|done|won|approved|complete|completed|customer|closed[ _-]won)$/,
    'success',
  ],
  [
    /^(lost|rejected|closed|blocked|cancelled|canceled|failed|archived|churned|retraction|closed[ _-]lost)$/,
    'error',
  ],
  [/^(review|negotiat\w*|partner|in[ _-]progress|qualified|proposal|material)$/, 'warning'],
  [/^(draft|new|pending|lead|prospect|open|minor)$/, undefined],
]
export function Choice({ value }: { value: unknown }) {
  const found = meanings.find(([word]) => word.test(textOf(value).toLowerCase()))
  return <Chip label={textOf(value)} color={found ? (found[1] ?? 'default') : 'info'} />
}
export const Document = ({ value }: { value: unknown }) => (
  <Box
    component="pre"
    sx={{
      m: 0,
      p: 3,
      bgcolor: 'grey.100',
      borderRadius: 1,
      overflow: 'auto',
      ...tokens.typography.code,
    }}
  >
    {JSON.stringify(value, null, 2)}
  </Box>
)
export const Paragraph = ({ value }: { value: unknown }) => (
  <Box component="span" sx={{ whiteSpace: 'pre-wrap' }}>
    {textOf(value)}
  </Box>
)
export { Mono }
