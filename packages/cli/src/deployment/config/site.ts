import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CONFIG_FILE, type FolderConfig, findConfig } from '../../config.ts'
import { ROOT } from '../runtime.ts'

/**
 * The folder of the site a deployment chose: any folder that holds a `platform.json`,
 * named from the root of the checkout or in full. It need not be one of the checkout's own.
 */
export function siteFolder(site: string, root: string = ROOT): FolderConfig {
  const dir = resolve(root, site)
  const config = existsSync(dir) ? findConfig(dir) : null
  if (!config)
    throw new Error(
      `PLATFORM_SITE names the folder of a site, one that holds ${CONFIG_FILE}: there is none at ${dir}`
    )
  return config
}

/** What is wrong with the folder a deployment names as its site, if anything is. */
export function aSiteFolder(value: string): string | undefined {
  if (!value) return undefined
  try {
    siteFolder(value)
    return undefined
  } catch {
    return `must be a folder that holds ${CONFIG_FILE}, named from the root of the checkout or in full`
  }
}

/**
 * The examples a checkout carries: the folders under examples/ whose `platform.json` says
 * they apply something to a database. They are offered when a deployment is asked for its
 * site, and a deployment may name any other folder.
 */
export function examplesIn(root: string): string[] {
  const directory = join(root, 'examples')
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(directory, entry.name, CONFIG_FILE)) &&
        findConfig(join(directory, entry.name))?.apply !== undefined
    )
    .map((entry) => entry.name)
    .sort()
}
