/**
 * The documentation of the platform, in the build of the console.
 *
 * The console shows the documents of the documentation, and the image
 * of the console holds the build of the server and nothing else: the
 * documents are read when the console is built, and the build holds
 * them.
 *
 * The plugin reads `docs/` and gives the server a virtual module: the
 * documents, parsed, and the files of the documentation that are not
 * documents.
 *
 * The names of the headings are the names of the documentation: they
 * come from the same place as the ones the check of the documentation
 * resolves, so a link that names a heading reaches it in the console as
 * it does in a rendered document.
 */

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { Plugin } from 'vite'
import type { Asset, Document } from '../src/domains/documentation'
import { headOf } from '../src/domains/documentation'

/** The module the plugin gives to the server. */
export const VIRTUAL = 'virtual:documentation'

/** The identifier of the module, as the tools of the build name it. */
const RESOLVED = `\0${VIRTUAL}`

/**
 * The build of the documentation.
 *
 * The documents are read from the directory of the documentation, and
 * they are held as they are written: the console parses a document
 * when a reader asks for it, and the markdown of the documentation is
 * the markdown of the repository.
 *
 * The files that are not documents are read as they are: the atlas of
 * the documentation is a page of html, and the console serves it as it
 * is.
 */
export async function buildOf(root: string): Promise<{ documents: Document[]; assets: Asset[] }> {
  const directory = join(root, 'docs')
  const documents: Document[] = []
  const assets: Asset[] = []
  await walk(directory, async (path) => {
    const source = relative(root, path)
    const name = relative(directory, path)
    if (name.endsWith('.md')) {
      const content = await readFile(path, 'utf8')
      const head = headOf(content, name.replace(/\.md$/, ''))
      documents.push({
        path: name.replace(/\.md$/, ''),
        source,
        directory: name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '',
        title: head.title,
        summary: head.summary,
        content,
      })
      return
    }
    assets.push({
      path: name,
      source,
      content: await readFile(path, 'utf8'),
    })
  })
  documents.sort((left, right) => left.path.localeCompare(right.path))
  assets.sort((left, right) => left.path.localeCompare(right.path))
  return { documents, assets }
}

/** Every file of a directory, recursively. */
async function walk(directory: string, visit: (path: string) => Promise<void>): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await walk(path, visit)
      continue
    }
    await visit(path)
  }
}

/**
 * The repository of the platform.
 *
 * The directory of the documentation is the mark of the repository: the
 * console is built in a directory of the repository, and the
 * documentation is a directory of the repository.
 */
export function repositoryOf(from: string): string {
  let current = resolve(from)
  for (;;) {
    if (existsSync(join(current, 'docs', 'platform'))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(from)
    current = parent
  }
}

/**
 * The plugin that gives the documentation to the console.
 *
 * The documentation is read when the server is built, and it is read
 * again when it changes in the development.
 */
export function documentation(): Plugin {
  let root = ''
  return {
    name: 'documentation',
    configResolved(config) {
      root = repositoryOf(config.root)
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null
    },
    async load(id) {
      if (id !== RESOLVED) return null
      const built = await buildOf(root)
      return [
        `export const documents = ${JSON.stringify(built.documents)}`,
        `export const assets = ${JSON.stringify(built.assets)}`,
        '',
      ].join('\n')
    },
    configureServer(server) {
      const directory = join(root, 'docs')
      server.watcher.add(directory)
      server.watcher.on('change', (file) => {
        if (!file.startsWith(directory)) return
        const module = server.moduleGraph.getModuleById(RESOLVED)
        if (module) server.moduleGraph.invalidateModule(module)
        server.ws.send({ type: 'full-reload' })
      })
    },
  }
}
