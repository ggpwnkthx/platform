import { chmodSync, writeFileSync } from 'node:fs'
import * as oidc from 'openid-client'
import { command } from './shared.ts'

export const token = command(
  'Sign in through OIDC_ISSUER in a browser and print a token for PGTOKEN or psql.',
  {
    out: {
      type: 'string',
      description: 'Write it to a file of your own (mode 0600) for PGTOKEN_FILE, and print nothing',
    },
  },
  async ({ args }) => {
    const issuer = process.env.OIDC_ISSUER
    if (!issuer) throw new Error('OIDC_ISSUER is required')
    // The local stack's Dex is plain HTTP; a real issuer is not.
    const insecure = issuer.startsWith('http:')
      ? { execute: [oidc.allowInsecureRequests] }
      : undefined
    const config = await oidc.discovery(
      new URL(issuer),
      process.env.OIDC_CLI_CLIENT_ID ?? 'platform-psql',
      undefined,
      oidc.None(),
      insecure
    )
    const device = await oidc.initiateDeviceAuthorization(config, { scope: 'openid email' })
    console.error(
      `Open ${device.verification_uri_complete ?? device.verification_uri} and enter the code ${device.user_code}`
    )
    const tokens = await oidc.pollDeviceAuthorizationGrant(config, device)
    if (!args.out) return console.log(tokens.access_token)
    writeFileSync(args.out, `${tokens.access_token}\n`, { mode: 0o600 })
    chmodSync(args.out, 0o600)
    console.error(
      `The token is in ${args.out}, readable by you alone: pass it as PGTOKEN_FILE=${args.out}`
    )
  }
)
