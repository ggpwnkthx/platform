import { Alert, Box, Stack, Typography } from '@mui/material'
import { describe } from '@platform/core'
import type { ReactNode } from 'react'
import tokens from 'virtual:design-tokens'

const { layout } = tokens
/** What the studio says one way everywhere: a statement, a refusal, an empty place, a section. */
export { type Standing, Statement } from './Statement.tsx'
/** What PostgreSQL refused, in its own words, with its SQLSTATE. The one way a refusal is shown. */
export function Refusal({ error }: { error: unknown }) {
  if (!error) return null
  const said = describe(error)
  return (
    <Alert severity="error" data-refusal sx={{ my: 2 }}>
      <strong>{said.title}</strong>
      {said.detail && <div>{said.detail}</div>}
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
