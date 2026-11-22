import { join } from 'node:path'
import type { DeployRuntime } from '../runtime.ts'
import type { StackSettings } from './settings.ts'

/** What the stack leaves behind: where it is, and what to do with it next. */
export function reportStack(
  r: DeployRuntime,
  s: StackSettings,
  last: { word?: string },
  issuer: string,
  relayUrl: string,
  siteUrl: string
): void {
  last.word = s.site ? `The site is at ${siteUrl}` : 'The stack is running'
  r.result(
    'The stack is running',
    [
      ...(s.site ? ([['Site', siteUrl]] as [string, string][]) : []),
      ['Issuer', issuer],
      ['Relay', relayUrl],
      ['PostgreSQL', `${s.db}:${s.postgresPort}`],
    ],
    [
      `Sign in as ${s.admin}, the break-glass administrator: Dex's form opens with the address filled in, and the password is PLATFORM_ADMIN_PASSWORD in ${r.envFile}.`,
      'Everybody else signs in through a connector: add an identity provider in deploy/dex/config.yaml.tmpl.',
      'PostgreSQL has no password: sign in with a token (`bun run cli token`), or administer the stack with `bun run cli deploy local admin <command>`.',
      s.site
        ? `The site's files are in ${join(s.site, '.dist')}: \`bun run cli deploy local ui\` builds them again, and they are served at once.`
        : `The interface is a static site: build it with \`bun run cli deploy local ui\` and publish packages/ui/dist to a CDN, with config.json pointing at ${relayUrl}.`,
    ]
  )
}
