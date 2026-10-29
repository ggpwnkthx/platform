#!/usr/bin/env bun
/**
 * The architecture check of the CLI.
 *
 * The core of the CLI — `src/domains` — holds the commands and the
 * policy of a command: what it asks, what it accepts and what it
 * refuses. It does not open a socket, it does not read a file and it
 * does not draw an answer: those are the ports of the platform, and the
 * runtime is the only place where the concrete pieces are assembled.
 *
 *   bun run architecture
 */

import { resolve } from 'node:path'
import { checkWebArchitecture, type WebRules } from '../../../tooling/web-architecture'

/** The rules of the CLI. */
export const CLI_RULES: WebRules = {
  forbiddenDirectories: ['shared', 'common', 'utils', 'util', 'lib', 'helpers', 'misc'],
  coreDirectories: ['domains'],
  forbiddenCorePackages: [],
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..')
  const problems = await checkWebArchitecture(root, CLI_RULES)
  for (const problem of problems) console.error(`${problem.file}: ${problem.message}`)
  if (problems.length > 0) {
    console.error(`${problems.length} problems of the architecture of the CLI`)
    process.exit(1)
  }
  console.log('the CLI holds its boundaries')
}
