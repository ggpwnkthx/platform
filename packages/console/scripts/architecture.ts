#!/usr/bin/env bun
/**
 * The architecture check of the console.
 *
 * The core of the console — `src/domains` — holds the facts and the
 * policy: the clients of the services, the sessions, the scope of an
 * operator, the values of the records, the map of the platform. It does
 * not import the interface: the pages, the islands and HonoX draw what
 * the core gives them. There is no cycle and no catch-all directory.
 *
 *   bun run architecture
 */

import { resolve } from 'node:path'
import { checkWebArchitecture, type WebRules } from '../../../tooling/web-architecture'

/** The rules of the console. */
export const CONSOLE_RULES: WebRules = {
  forbiddenDirectories: ['shared', 'common', 'utils', 'util', 'lib', 'helpers', 'misc'],
  coreDirectories: ['domains'],
  forbiddenCorePackages: [
    'hono',
    'hono/jsx',
    'hono/jsx/dom',
    'hono/jsx-renderer',
    'honox',
    'honox/server',
    'honox/client',
    'honox/factory',
    'vite',
  ],
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..')
  const problems = await checkWebArchitecture(root, CONSOLE_RULES)
  for (const problem of problems) console.error(`${problem.file}: ${problem.message}`)
  if (problems.length > 0) {
    console.error(`${problems.length} problems of the architecture of the console`)
    process.exit(1)
  }
  console.log('the console holds its boundaries')
}
