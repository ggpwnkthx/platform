/** The ui command: build the interface, and serve it while it is worked on. */
import { join } from 'node:path'
import { root } from '@platform/ui/paths.ts'
import { buildSite, extensionsPlugin, inPageAssets, seamPlugin } from './build.ts'
import { applyFiles, extensionsModule, type FolderConfig, findConfig } from '../config.ts'
import { serveInterface } from './dev.ts'
import { UI_HELP } from './help.ts'

export { UI_HELP } from './help.ts'
export { findConfig } from '../config.ts'

const KNOWN = ['--dir=', '--production', '--relay=', '--port=']

/**
 * The site a folder asks for, and where it is written: in the folder itself, beside what it
 * is built from. Without a folder of its own, the interface is written where it is published
 * from.
 */
function siteOf(config: FolderConfig | null, development: boolean) {
  return {
    out: config ? join(config.dir, '.dist') : join(root, 'dist'),
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
  // A folder that applies something is built with it installed in the page, so that it can be
  // worked on with nothing running. The published interface is what a deployment serves, and
  // whoever builds for one says so.
  const development = !rest.includes('--production') && config?.apply !== undefined

  if (action === 'dev') {
    await serveInterface(config, { relay, port })
    return 0
  }

  const site = siteOf(config, development)
  // What the site adds is the site's own in either build; the database in the page is the
  // development build's only.
  const extensions = extensionsModule(config)
  const plugins = [
    ...(development ? [seamPlugin(applyFiles(config!))] : []),
    ...(extensions ? [extensionsPlugin(extensions)] : []),
  ]
  const count = await buildSite({
    out: site.out,
    environment: site.environment,
    title: site.title,
    relay: process.env.PLATFORM_RELAY_URL,
    plugins,
    assets: development ? inPageAssets() : [],
  })
  console.log(
    `Built ${count} static pages and one client bundle in ${site.out.replace(join(root, '..', '..'), '.')}${development ? ' (development)' : ''}`
  )
  return 0
}
