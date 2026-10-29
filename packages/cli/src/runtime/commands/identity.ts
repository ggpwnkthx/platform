/**
 * The identity of the caller, and the state of the deployment.
 *
 * These are the commands that do not change anything: they sign the
 * caller in, they say who the caller is, and they say whether the
 * deployment answers. They are the first commands a reader runs, and
 * they are the ones that tell whether the rest of the CLI can work.
 */

import type { CommandSpec } from '../../app/commands'
import { stringOf } from '../../app/commands'
import { CliFailure } from '../../domains/failure'
import { claimsOf, signIn } from '../../domains/identity'
import { callerToken } from './calls'
import { probe, probesOf, type Probe } from '../../domains/status'
import { VERSION } from '../version'

/**
 * The subject of a token, read from its claims.
 *
 * The claims are read and not verified: the CLI is not the party that
 * verifies the token, the services are. The subject is read to tell the
 * reader who signed in.
 *
 * @param token the token of the caller.
 */
export function subjectOf(token: string): string | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
      sub?: unknown
    }
    return typeof payload.sub === 'string' ? payload.sub : undefined
  } catch {
    return undefined
  }
}

/**
 * The browser that prints the address of the login.
 *
 * A machine that has no browser — a server, a container, a terminal of
 * somebody else — opens the address of the login by hand, and the CLI
 * prints it.
 */
const printingBrowser = {
  async open(url: string): Promise<void> {
    process.stdout.write(`${url}\n`)
  },
}

/** The command that signs the caller in. */
export const login: CommandSpec = {
  name: 'login',
  summary: 'sign the caller in',
  description:
    'The login opens the page of the provider, and the provider sends the caller back to an address of the machine. The tenant has to allow that address, and the CLI is told which one it uses.',
  options: [
    { name: 'redirect-uri', kind: 'string', summary: 'the address of the callback of the login' },
    { name: 'tenant', kind: 'string', summary: 'the tenant of a shared client' },
    { name: 'scope', kind: 'string', summary: 'the scopes the CLI asks for' },
    {
      name: 'print-url',
      kind: 'boolean',
      summary: 'print the address of the login and wait for it',
    },
  ],
  examples: ['platformctl login --tenant acme'],
  async run(input) {
    const context = input.context
    const clientId = context.clientId
    const clientSecret = context.clientSecret
    const accessUrl = context.accessUrl
    const redirectUri = stringOf(input.options, 'redirect-uri') ?? context.redirectUri
    if (!clientId || !clientSecret) {
      throw new CliFailure(
        'the client of the CLI is missing: set PLATFORMCTL_CLIENT_ID and PLATFORMCTL_CLIENT_SECRET',
        2,
        'not_configured'
      )
    }
    if (!accessUrl) {
      throw new CliFailure(
        'the address of Access is missing: set PLATFORMCTL_ACCESS_URL',
        2,
        'not_configured'
      )
    }
    if (!redirectUri) {
      throw new CliFailure(
        'the address of the callback is missing: set PLATFORMCTL_REDIRECT_URI, for example ' +
          'http://127.0.0.1:8765/oauth/callback, and allow it in the tenant',
        2,
        'not_configured'
      )
    }
    const printed = input.options['print-url'] === true
    const credential = await signIn({
      http: input.services.http,
      browser: printed ? printingBrowser : input.services.browser,
      callback: input.services.callback,
      crypto: input.services.crypto,
      credentials: input.services.credentials,
      accessUrl,
      clientId,
      clientSecret,
      redirectUri,
      tenant: stringOf(input.options, 'tenant') ?? context.tenantId,
      scope: stringOf(input.options, 'scope'),
    })
    const subject = subjectOf(credential.accessToken)
    if (subject) {
      // The subject is kept with the credential: it is what the reader
      // of the machine sees, and it is not a secret.
      await input.services.credentials.write({ ...credential, subject })
    }
    if (printed) {
      return {
        value: { signedIn: true, subject: subject ?? '' },
        message: 'the address of the login was printed; open it to sign in',
      }
    }
    return {
      value: {
        signedIn: true,
        subject: subject ?? '',
        expiresAt: credential.expiresAt ?? null,
      },
      message: 'the caller is signed in',
    }
  },
}

/** The command that signs the caller out. */
export const logout: CommandSpec = {
  name: 'logout',
  summary: 'forget the credential of the caller',
  async run(input) {
    await input.services.credentials.clear()
    return { value: { signedIn: false }, message: 'the caller is signed out' }
  },
}

/** The command that says who the caller is. */
export const whoami: CommandSpec = {
  name: 'whoami',
  summary: 'show the identity of the caller',
  async run(input) {
    const credential = await input.services.credentials.read()
    const token = await callerToken(input)
    const accessUrl = input.context.accessUrl
    if (!accessUrl) {
      throw new CliFailure(
        'the address of Access is missing: set PLATFORMCTL_ACCESS_URL',
        2,
        'not_configured'
      )
    }
    const claims = (await claimsOf(input.services.http, accessUrl, {
      accessToken: token,
      subject: credential?.subject,
    })) as {
      sub?: string
      email?: string
      name?: string
      roles?: readonly string[]
    }
    return {
      value: {
        subject: claims.sub ?? credential?.subject ?? '',
        email: claims.email ?? '',
        name: claims.name ?? '',
        roles: claims.roles ?? [],
      },
    }
  },
}

/** The command that shows the state of the deployment. */
export const status: CommandSpec = {
  name: 'status',
  summary: 'show the state of the services of the deployment',
  options: [{ name: 'watch', kind: 'boolean', summary: 'show the state again every five seconds' }],
  async run(input) {
    const context = input.context
    const read = async (): Promise<readonly Probe[]> =>
      probesOf(input.services.http, {
        gatewayUrl: context.gatewayUrl,
        controlUrl: context.controlUrl,
        accessUrl: context.accessUrl,
      })
    const found = await read()
    if (found.length === 0) {
      throw new CliFailure(
        'the profile names no service: set PLATFORMCTL_GATEWAY_URL or PLATFORMCTL_ACCESS_URL',
        2,
        'not_configured'
      )
    }
    const lines = found.map((entry) => {
      const state = entry.ok ? 'ok' : entry.error ? 'unreachable' : `refused ${entry.status}`
      return `${entry.name.padEnd(18)} ${state}`
    })
    const value = found.map((entry) => ({
      name: entry.name,
      url: entry.url,
      status: entry.status,
      ok: entry.ok,
    }))
    if (input.options.watch === true) {
      await watch(read)
      return { value, lines }
    }
    return {
      value,
      lines,
      exit: found.every((entry) => entry.ok) ? 0 : 7,
    }
  },
}

/**
 * Shows the state of the deployment again and again.
 *
 * The reader stops the command with a signal, and the command ends
 * without a refusal: the state was shown, and the reader asked for it.
 *
 * @param input what the command received.
 * @param read the reading of the probes.
 */
async function watch(read: () => Promise<readonly Probe[]>): Promise<void> {
  let stopped = false
  const stop = (): void => {
    stopped = true
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  while (!stopped) {
    const found = await read()
    const lines = found.map((entry) => {
      const state = entry.ok ? 'ok' : entry.error ? 'unreachable' : `refused ${entry.status}`
      return `${entry.name.padEnd(18)} ${state}`
    })
    process.stdout.write(`${lines.join('\n')}\n`)
    await new Promise<void>((resolve) => setTimeout(resolve, 5000))
  }
}

/** The command that shows the version of the CLI and of the deployment. */
export const version: CommandSpec = {
  name: 'version',
  summary: 'show the version of the CLI and of the deployment',
  async run(input) {
    const context = input.context
    const found: Record<string, string> = { cli: VERSION }
    if (context.gatewayUrl) {
      const answer = await probe(input.services.http, 'gateway', context.gatewayUrl, '/healthz')
      const body = answer.body as { version?: unknown } | null
      if (body && typeof body.version === 'string') found.gateway = body.version
    }
    if (context.accessUrl) {
      const answer = await probe(input.services.http, 'access', context.accessUrl, '/healthz')
      const body = answer.body as { version?: unknown } | null
      if (body && typeof body.version === 'string') found.access = body.version
    }
    return { value: found }
  },
}

/** The command that says whether the CLI can work on this deployment. */
export const doctor: CommandSpec = {
  name: 'doctor',
  summary: 'check the configuration of the CLI and the state of the deployment',
  async run(input) {
    const context = input.context
    const checks: { name: string; ok: boolean; detail: string }[] = []
    checks.push({
      name: 'the profile',
      ok: Boolean(context.gatewayUrl || context.accessUrl),
      detail:
        context.gatewayUrl || context.accessUrl
          ? `the profile "${context.name}" names a deployment`
          : `the profile "${context.name}" names no service`,
    })
    const credential = await input.services.credentials.read()
    const fromEnvironment = input.context.token
    checks.push({
      name: 'the credential',
      ok: credential !== null || fromEnvironment !== undefined,
      detail: fromEnvironment
        ? 'the caller authenticates itself with the environment'
        : credential
          ? `the caller is signed in${credential.expiresAt ? ' until ' + new Date(credential.expiresAt).toISOString() : ''}`
          : 'the caller is not signed in',
    })
    const found = await probesOf(input.services.http, {
      gatewayUrl: context.gatewayUrl,
      controlUrl: context.controlUrl,
      accessUrl: context.accessUrl,
    })
    for (const entry of found) {
      checks.push({
        name: entry.name,
        ok: entry.ok,
        detail: entry.ok ? `answered ${entry.status}` : (entry.error ?? `answered ${entry.status}`),
      })
    }
    return {
      value: checks,
      lines: checks.map(
        (check) => `${check.ok ? 'ok  ' : 'fail'} ${check.name.padEnd(18)} ${check.detail}`
      ),
      exit: checks.every((check) => check.ok) ? 0 : 7,
    }
  },
}
