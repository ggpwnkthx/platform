/** The ui command: build the interface, and serve it while it is worked on. */
import { join } from 'node:path'
import { root } from '@platform/ui/paths.ts'
import { buildSite, extensionsPlugin, inPageAssets, seamPlugin } from './build.ts'
import {
  databaseModule,
  extensionsModule,
  findConfig,
  findSiteConfig,
  type InterfaceConfig,
} from './config.ts'
import { serveInterface } from './dev.ts'
import { UI_HELP } from './help.ts'

export { UI_HELP } from './help.ts'
export { findConfig } from './config.ts'

const KNOWN = ['--dir=', '--production', '--relay=', '--port=']

/** The site a configuration asks for, and where it is written. */
function siteOf(config: InterfaceConfig | null, development: boolean) {
  const out = config?.out
    ? join(config.dir, config.out)
    : development
      ? join(config!.dir, '.dist')
      : join(root, 'dist')
  return {
    out,
    environment: (development ? 'development' : 'production') as 'development' | 'production',
    title: development ? ' (development)' : undefined,
  }
}

export async function ui(args: string[]): Promise<number> {
  const [action, ...rest] = args
  if (!action || ['help', '--help', '-h'].includes(action)) {
    console.log(UI_HELP)
    return 0
  }
  if (!['build', 'dev'].includes(action))
    throw new Error(`Unknown action: ${action}. Supported actions: build, dev. Run ui help.`)
  const unknown = rest.find((a) => a.startsWith('--') && !KNOWN.some((k) => a.startsWith(k)))
  if (unknown) throw new Error(`Unknown option: ${unknown}`)
  const dir = rest.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) ?? process.cwd()
  const relay = rest.find((a) => a.startsWith('--relay='))?.slice('--relay='.length)
  const port = Number(
    rest.find((a) => a.startsWith('--port='))?.slice('--port='.length) ?? process.env.PORT ?? 5173
  )

  const config = findConfig(dir)
  // The published interface is what a deployment serves; a configuration may say otherwise.
  const development = !rest.includes('--production') && config?.mode === 'development'

  if (action === 'dev') {
    await serveInterface(config, { relay, port })
    return 0
  }

  const site = siteOf(config, development)
  // What the site adds is the site's own in either mode; the database is the example's only.
  const extensions = extensionsModule(config)
  const plugins = [
    ...(development ? [seamPlugin(databaseModule(config!))] : []),
    ...(extensions ? [extensionsPlugin(extensions)] : []),
  ]
  const count = await buildSite({
    out: site.out,
    environment: site.environment,
    title: site.title,
    relay: process.env.PLATFORM_RELAY_URL,
    config: findSiteConfig(dir),
    plugins,
    assets: development ? inPageAssets(config!.dir) : [],
  })
  console.log(
    `Built ${count} static pages and one client bundle in ${site.out.replace(join(root, '..', '..'), '.')}${development ? ' (development)' : ''}`
  )
  return 0
}
