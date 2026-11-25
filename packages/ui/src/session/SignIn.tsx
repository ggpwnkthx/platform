import { Alert, Box, Button, ButtonBase, CircularProgress, Stack, Typography } from '@mui/material'
import type { SxProps } from '@mui/material'
import { useEffect, useState } from 'react'
import { useLogin } from 'react-admin'
import { useLocation } from 'react-router-dom'
import { startInPage } from 'virtual:platform-site'
import tokens from 'virtual:design-tokens'
import { Mono } from '../kit/marks.tsx'
import type { Person } from './inpage.ts'
import { session } from './session.ts'

const { colors, rounded } = tokens
const steps = [
  ['Your sign-in', 'The issuer vouches for who you are'],
  ['PostgreSQL', 'Checks the token and logs in your role'],
  ['Your role and records', 'Every grant and policy applies, as in psql'],
]
const card: SxProps = {
  border: 1,
  borderColor: 'divider',
  borderRadius: rounded.md,
  p: 4,
  bgcolor: 'background.paper',
  textAlign: 'left',
  display: 'block',
  width: '100%',
}

/** The sign-in: light like the rest. Three steps on the grey, and the way in on the paper. */
export function SignIn() {
  const login = useLogin()
  // The page the reader asked for, which the sign-in returns them to.
  const asked = useLocation().state as { nextPathname?: string; nextSearch?: string } | null
  const [signing, setSigning] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // The dev mode's people are read from the PostgreSQL in the page, once it has started.
  const [people, setPeople] = useState<Person[] | null>(startInPage ? null : [])
  useEffect(() => void startInPage?.people().then(setPeople), [])
  const notice = refusal ?? session.notice()
  const enter = (role?: string) => {
    setSigning(true)
    login({ role, returnTo: `${asked?.nextPathname ?? '/'}${asked?.nextSearch ?? ''}` }).catch(
      (error) => {
        setRefusal(error.message)
        setSigning(false)
      }
    )
  }
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        minHeight: '100vh',
      }}
    >
      <Stack spacing={2.5} sx={{ bgcolor: 'grey.100', justifyContent: 'center', px: 12, py: 8 }}>
        {steps.map(([title, note], at) => (
          <Box
            key={title}
            sx={[card, { borderColor: at === 1 ? colors['studio-orange'] : 'divider' }] as SxProps}
          >
            <Typography
              variant="h3"
              sx={{ color: at === 1 ? colors['studio-orange-ink'] : 'text.primary' }}
            >
              {title}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {note}
            </Typography>
          </Box>
        ))}
      </Stack>
      <Stack
        spacing={4}
        sx={{ justifyContent: 'center', px: 12, py: 8, maxWidth: tokens.layout.form }}
      >
        <Typography variant="h1">Sign in to Platform</Typography>
        <Typography sx={{ color: 'text.secondary' }}>
          You are a PostgreSQL role. What you may do here is exactly what you may do in psql: the
          database decides, and the interface shows its answer.
        </Typography>
        {notice && <Alert severity={refusal || !startInPage ? 'error' : 'info'}>{notice}</Alert>}
        {signing || !people ? (
          <Box sx={{ display: 'flex', gap: 3, alignItems: 'center', color: 'text.secondary' }}>
            <CircularProgress size={tokens.layout.icon} />{' '}
            {startInPage ? 'Starting PostgreSQL in the page' : 'Signing in'}
          </Box>
        ) : startInPage ? (
          people.map((person) => (
            <ButtonBase key={person.role} sx={card} onClick={() => enter(person.role)}>
              <Mono>{person.role}</Mono>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {person.note}
              </Typography>
            </ButtonBase>
          ))
        ) : (
          <Box>
            <Button variant="contained" onClick={() => enter()}>
              Sign in
            </Button>
          </Box>
        )}
      </Stack>
    </Box>
  )
}
