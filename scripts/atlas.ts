#!/usr/bin/env bun
/**
 * The atlas of the platform.
 *
 * The atlas is one page that holds the whole platform: the callers, the
 * three services, the stores, the identity provider, and the contracts
 * between them. It is a document of html with a script in it, it has no
 * build step, and it is opened from the repository.
 *
 * The command prints the path of the atlas and opens it in the browser
 * of the machine, when the machine has one.
 *
 *   bun run scripts/atlas.ts
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** The root of the repository. */
const root = resolve(import.meta.dir, '..')

/** The atlas. */
const atlas = resolve(root, 'docs', 'platform', 'atlas.html')

/** The opener of the machine: the one that opens a browser. */
const OPENER =
  process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'

/** The main of the command. */
function main(): void {
  if (!existsSync(atlas)) {
    console.error(`the atlas is not there: ${atlas}`)
    process.exit(1)
  }
  console.log(`the atlas of the platform: ${atlas}`)
  const opened = spawn(OPENER, [atlas], { stdio: 'ignore', detached: true })
  opened.on('error', () => {
    console.log('the browser of the machine did not open; the path above opens it by hand')
  })
  opened.unref()
}

if (import.meta.main) main()
