#!/usr/bin/env bun
/**
 * The paths of the clients of the data API.
 *
 * The console, the CLI and the published client of Data speak to the
 * same contract, and they speak to it with the same paths. The
 * published client cannot import the client workspace — it is
 * installed outside of this repository — and the client workspace is
 * not published, so the paths are written twice.
 *
 * The check reads the two sources and refuses the published client when
 * it names a path that the console and the CLI do not know: a path
 * that only one of them writes is a path that answers differently
 * depending on who asks.
 *
 *   bun run scripts/check-client-paths.ts
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathsOf, PUBLISHED_CLIENT, SHARED_CLIENT, unknownPaths } from '../tooling/client-paths'

/** The root of the repository. */
const root = resolve(import.meta.dir, '..')

/** The main of the check. */
async function main(): Promise<void> {
  const published = pathsOf(PUBLISHED_CLIENT, await readFile(join(root, PUBLISHED_CLIENT), 'utf8'))
  const shared = pathsOf(SHARED_CLIENT, await readFile(join(root, SHARED_CLIENT), 'utf8'))
  const unknown = unknownPaths(published, shared)
  if (unknown.length > 0) {
    for (const path of unknown) {
      console.error(
        `the published client of Data names the path "${path}", and the client of the console and of the CLI does not know it`
      )
    }
    console.error(
      `${unknown.length} paths of the published client that the clients of the platform do not know`
    )
    process.exit(1)
  }
  console.log(
    `the ${new Set(published.map((entry) => entry.path)).size} paths of the published client are the paths of the clients of the platform`
  )
}

if (import.meta.main) await main()
