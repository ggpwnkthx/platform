import {
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core'
import { useGate } from '../session/context.ts'
const steps = [
  ['Your sign-in', 'The issuer vouches for who you are'],
  ['PostgreSQL', 'Checks the token and logs in your role'],
  ['Your role and rows', 'Every grant and policy applies, as in psql'],
]
/** Light like the rest: what happens when you sign in, and the way in. */
export function SignIn() {
  const { phase, notice, people, signIn, signInAs } = useGate()
  return (
    <div className="signin">
      <div className="art">
        <Stack maw={360} mx="auto" gap="xs">
          {steps.map(([title, note], at) => (
            <Paper
              key={title}
              withBorder
              p="md"
              radius="md"
              shadow="xs"
              style={at === 1 ? { borderColor: 'var(--orange)' } : undefined}
            >
              <Text fw={650} c={at === 1 ? 'orange.8' : undefined}>
                {title}
              </Text>
              <Text fz="sm" c="dimmed">
                {note}
              </Text>
            </Paper>
          ))}
        </Stack>
      </div>
      <div>
        <Stack maw={440} gap="md">
          <Title fz={28} lts="-0.025em">
            Sign in to Platform
          </Title>
          <Text c="dimmed">
            You are a PostgreSQL role. What you may do here is exactly what you may do in psql: the
            database decides, and the interface shows its answer.
          </Text>
          {notice && <Alert color={people.length ? 'blue' : 'red'}>{notice}</Alert>}
          {phase === 'signing-in' ? (
            <Group>
              <Loader size="sm" />
              <Text c="dimmed">
                {people.length ? 'Starting PostgreSQL in the page' : 'Signing in'}
              </Text>
            </Group>
          ) : people.length ? (
            people.map((person) => (
              <UnstyledButton key={person.role} onClick={() => signInAs(person.role)}>
                <Paper withBorder p="md" radius="md">
                  <Text className="mono">{person.role}</Text>
                  <Text fz="sm" c="dimmed">
                    {person.note}
                  </Text>
                </Paper>
              </UnstyledButton>
            ))
          ) : (
            <Button size="lg" onClick={() => signIn()}>
              Sign in
            </Button>
          )}
        </Stack>
      </div>
    </div>
  )
}
