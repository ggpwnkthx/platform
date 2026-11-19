import { useLocation } from 'preact-iso'
import { withoutIssuer } from '../pg/connect.ts'
import { useSession } from '../session.tsx'
import { Notice } from '../ui/bits.tsx'
import { Button } from '../ui/button.tsx'
import { SignInIcon, SpinnerIcon } from '../ui/icons.tsx'
import { Initials } from '../ui/bits.tsx'

export function SignIn() {
  const { phase, notice, signIn, signInAs, config } = useSession()
  const location = useLocation()
  const busy = phase === 'starting' || phase === 'signing-in'
  const returnTo = location.path === '/' ? '/content' : location.url
  return (
    <div class="signin">
      <section class="signin-art" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="44" height="44">
          <title>Platform</title>
          <rect x="3" y="3" width="26" height="26" rx="7" class="mark-ground" />
          <path d="M10 22V10h7a4.5 4.5 0 0 1 0 9h-7" class="mark-line" />
        </svg>
        <div class="signin-diagram">
          <span>
            Your sign-in
            <small>The issuer vouches for who you are</small>
          </span>
          <i />
          <span>
            PostgreSQL
            <small>Checks the token and logs in your role</small>
          </span>
          <i />
          <span>
            Your role, your rows
            <small>Every grant and policy applies, as in psql</small>
          </span>
        </div>
      </section>
      <section class="signin-panel">
        <div class="signin-card">
          <h1>Sign in to Platform</h1>
          <p class="signin-lead">
            PostgreSQL checks your token itself and logs you in as your own role. What you can see
            and change here is exactly what you can in psql.
          </p>
          {notice && <Notice tone="danger" title={notice} />}
          {withoutIssuer.people.length > 0 ? (
            <div class="signin-people">
              <p class="signin-dev">{withoutIssuer.notice}</p>
              {withoutIssuer.people.map((person) => (
                <button
                  key={person.role}
                  type="button"
                  class="person"
                  disabled={busy}
                  onClick={() => signInAs(person.role)}
                >
                  <Initials name={person.role} />
                  <span>
                    <strong>{person.role}</strong>
                    <small>{person.note}</small>
                  </span>
                </button>
              ))}
              {busy && (
                <p class="signin-wait">
                  <SpinnerIcon class="spin" size={16} aria-hidden="true" /> {withoutIssuer.starting}
                </p>
              )}
            </div>
          ) : (
            <>
              <Button
                tone="primary"
                class="signin-button"
                icon={<SignInIcon size={18} aria-hidden="true" />}
                busy={busy}
                onClick={() => signIn(returnTo)}
              >
                {phase === 'signing-in' ? 'Signing in' : 'Sign in'}
              </Button>
              <p class="signin-fine">
                {config ? (
                  <>
                    Through <span class="mono">{new URL(config.issuer).host}</span> into the{' '}
                    <span class="mono">{config.database}</span> database. Your token stays in this
                    page's memory: reloading signs you out.
                  </>
                ) : (
                  'Reading the sign-in settings'
                )}
              </p>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
