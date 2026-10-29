#!/usr/bin/env bun
/**
 * The import boundary check of Access.
 *
 * The domain organization of the specification (spec §16) is part of the
 * implementation contract: a domain owns its policy, the application
 * orchestrates the domains, the platform implements the ports of the
 * domains and the runtime is the only place where the concrete pieces
 * are assembled.
 *
 * This script checks that contract on the source tree. It is run by the
 * test suite (`test/architecture/imports.test.ts`) and by the CI
 * workflow, so a violation fails the build instead of being noticed in
 * a review.
 *
 * The rules are the ones of the gateway (`docs/gateway/internals.md`),
 * copied and extended with the matrix of Access:
 *
 * 1. A domain is imported through its public entry point (`index.ts`).
 * 2. The four domains of Access are independent: none of them depends on
 *    another one.
 * 3. Core domain code imports no framework (Hono), no Bun api, no adapter,
 *    no application, no platform and no runtime.
 * 4. The application uses the public entry points of the domains and the
 *    observation interfaces, never a concrete adapter.
 * 5. The platform implements the ports of the domains, it makes no policy
 *    decision and it knows neither the application nor the runtime.
 * 6. The observation layer is independent of everything else.
 * 7. The runtime is the composition root: it may assemble everything.
 * 8. There are no catch-all directories and no import cycles.
 * 9. The framework of the application belongs to the application and the
 *    api of the runtime belongs to the platform of the runtime.
 * 10. The environment is read in the runtime only: a domain that reads
 *     `process.env` has a setting that nobody validated.
 *
 * The rules themselves are the engine of `tooling/architecture.ts`, and
 * the matrix below is what makes them the rules of Access.
 */

import { resolve } from 'node:path'
import {
  checkArchitecture as check,
  findForbiddenDirectories as find,
  loadSources,
  locate as locateOf,
  unlocatedFiles as unlocatedOf,
  type ArchitectureRules,
  type SourceFile,
  type Violation,
} from '../../../../tooling/architecture'

/**
 * The domains of Access and the domains they may use.
 *
 * The four domains are independent: the identity of a caller, the access
 * of a caller, the administration and the provider of Access do not share a
 * policy. What they share is the tables of the eight tables, and that is read
 * through the repositories of the platform.
 */
export const DOMAIN_DEPENDENCIES: Record<string, readonly string[]> = {
  identity: [],
  authorization: [],
  administration: [],
  provider: [],
}

/** The rules of the boundaries of Access. */
export const RULES: ArchitectureRules = {
  domainDependencies: DOMAIN_DEPENDENCIES,
  entryPoints: ['src/main.ts'],
  forbiddenDomainPackages: [
    'hono',
    'bun',
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'node:http2',
  ],
  forbiddenDirectories: [
    'utils',
    'util',
    'helpers',
    'helper',
    'services',
    'service',
    'repositories',
    'repository',
    'common',
    'shared',
    'misc',
  ],
  environmentReaders: ['src/runtime/env.ts'],
}

/** The location of a file in the layers of the source of Access. */
export function locate(path: string): ReturnType<typeof locateOf> {
  return locateOf(path, RULES)
}

/** Checks the import boundaries of the source of Access. */
export function checkArchitecture(files: SourceFile[]): Violation[] {
  return check(files, RULES)
}

/** Reports the files of the source of Access that are in no known layer. */
export function unlocatedFiles(files: SourceFile[]): string[] {
  return unlocatedOf(files, RULES)
}

/** Reports the directories of the source of Access that collect unrelated behaviour. */
export function findForbiddenDirectories(root: string): Promise<string[]> {
  return find(root, RULES)
}

export { loadSources }
export type { SourceFile, Violation }

/** Runs the check and prints the violations. */
export async function main(): Promise<number> {
  const root = resolve(import.meta.dir, '../..')
  const sources = await loadSources(root)
  const violations = checkArchitecture(sources)
  const directories = await findForbiddenDirectories(root)
  for (const directory of directories) {
    violations.push({
      file: directory,
      rule: 'catch-all-directory',
      message: `"${directory}" collects unrelated behaviour: every piece of code belongs to a domain`,
    })
  }
  if (violations.length === 0) {
    console.log(`the import boundaries are respected (${sources.length} files)`)
    return 0
  }
  for (const violation of violations) {
    console.error(`${violation.file}: [${violation.rule}] ${violation.message}`)
  }
  console.error(`${violations.length} import boundary violations`)
  return 1
}

if (import.meta.main) {
  process.exit(await main())
}
