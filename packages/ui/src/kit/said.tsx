import { Alert, Box, Stack, Typography } from '@mui/material'
import { describe, sqlState } from '@platform/core'
import type { ReactNode } from 'react'
import tokens from 'virtual:design-tokens'

const { layout } = tokens
/** What the studio says one way everywhere: a statement, a refusal, an empty place, a section. */
export { type Standing, Statement } from './Statement.tsx'
/** What to do about the refusals people meet most, in one line, under PostgreSQL's own. */
function nextStep(code?: string): string | null {
  if (!code) return null
  if (code === '42501')
    return 'Your role lacks the privilege this needs. The owner of the object can GRANT it, under Definition and privileges, then Privileges.'
  if (code === '23505')
    return 'Another row already holds this value, and a UNIQUE constraint forbids a duplicate. Update this row or that one.'
  if (code === '23503')
    return 'It points at a row that does not exist, or another row still points at this one.'
  if (code === '23502') return 'A required column is empty. Fill it in, then save again.'
  if (code === '23514') return 'A value violates a CHECK constraint of the table.'
  if (code === '22P02' || code === '22007' || code === '22008')
    return 'A value is not in the form its column expects: a number, a date, an identifier.'
  if (code === '40001' || code === '40P01')
    return 'Someone else changed the same thing at the same moment. Try again.'
  if (code === '42P01' || code === '42703')
    return 'Something it names does not exist, or your role may not see it.'
  if (code === '42601') return 'PostgreSQL could not read the SQL. Look near the word it points at.'
  if (code === '01006' || code === '01007')
    return 'Nothing changed: the role already held, or never held, what was asked.'
  return null
}
/** What PostgreSQL refused, in its own words, with its SQLSTATE. The one way a refusal is shown. */
export function Refusal({ error }: { error: unknown }) {
  if (!error) return null
  const said = describe(error)
  const step = nextStep(sqlState(error))
  return (
    <Alert severity="error" data-refusal sx={{ my: 2 }}>
      <strong>{said.title}</strong>
      {said.detail && <div>{said.detail}</div>}
      {step && (
        <Box data-next-step sx={{ mt: 1.5 }}>
          {step}
        </Box>
      )}
    </Alert>
  )
}
/** Nothing here, and why. The one way an empty place is shown. */
export const Empty = ({ children }: { children: ReactNode }) => (
  <Typography variant="body2" data-empty sx={{ color: 'text.secondary', py: 4 }}>
    {children}
  </Typography>
)
/** A page section: a heading, a short note and a hairline above it; never a box. */
export function Section(props: {
  title: ReactNode
  note?: ReactNode
  /** What may be added here, at the heading's right. */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Stack
      component="section"
      spacing={3}
      sx={{
        borderTop: 1,
        borderColor: 'divider',
        pt: 5,
        mt: 7,
        '&:first-of-type': { borderTop: 0, pt: 0, mt: 0 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 4 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h3">{props.title}</Typography>
          {props.note && (
            <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: layout.measure }}>
              {props.note}
            </Typography>
          )}
        </Box>
        {props.action}
      </Box>
      {props.children}
    </Stack>
  )
}
