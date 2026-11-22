import { join } from 'node:path'
import type { DeployRuntime, RunOptions } from '../runtime.ts'
import { chosenSite, siteAddress } from './settings.ts'

/**
 * Builds the static interface and says what to publish. The bundle is the same everywhere;
 * the deployment's own names live in config.json and in the headers file beside it.
 */
export async function buildInterface(
  r: DeployRuntime,
  computed: Record<string, string>
): Promise<number> {
  const { code, where, relay } = await buildFiles(r, computed)
  if (code) return code
  r.print(
    `The interface is built in ${where}: publish those files to your CDN, including config.json
and the _headers file (Cloudflare Pages and Netlify read it; other CDNs need the same headers).
The relay is at ${relay || 'ws://localhost:8081'}; set PLATFORM_RELAY_URL to
its address before publishing, and PLATFORM_PUBLIC_URL to the address of the site.`
  )
  return 0
}

/** Writes the site's files for this deployment, and says where they are. */
export async function buildFiles(
  r: DeployRuntime,
  computed: Record<string, string>,
  task?: RunOptions['task']
): Promise<{ code: number; where: string; relay: string }> {
  const env = {
    ...r.env,
    ...computed,
    PLATFORM_PUBLIC_URL: siteAddress(r, computed),
    PLATFORM_ISSUER: r.env.PLATFORM_ISSUER ?? r.env.OIDC_ISSUER ?? computed.PLATFORM_ISSUER ?? '',
    PLATFORM_RELAY_URL: r.env.PLATFORM_RELAY_URL ?? computed.PLATFORM_RELAY_URL ?? '',
  }
  // The site the deployment chose, if it chose one: the platform's own interface is
  // built otherwise.
  const site = chosenSite(r)
  const built = site
    ? await r.run(
        ['bun', 'packages/cli/src/cli.ts', 'ui', 'build', `--dir=${site}`, '--production'],
        { env, task }
      )
    : await r.run(['bun', 'run', 'build:ui'], { env, task })
  return {
    code: built,
    where: site ? join(site, '.dist') : 'packages/ui/dist',
    relay: env.PLATFORM_RELAY_URL,
  }
}
