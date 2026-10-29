#!/usr/bin/env bun
/**
 * The import boundary check of the gateway.
 *
 * The domain organization of the specification is part of the
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
 * The rules are the ones of docs/gateway/internals.md (Import rules):
 *
 * 1. A domain exposes a deliberate `index.ts`. The consumers import that
 *    entry point and not a file of the domain.
 * 2. Routing, authentication and rate limiting depend on no other domain.
 * 3. Configuration may use the public schemas of routing and authentication.
 * 4. Workspace access may use the principal of authentication and the
 *    identifier types of routing.
 * 5. Forwarding may use the principal type of authentication.
 * 6. Proxying and the websockets may use the plans of forwarding.
 * 7. Core domain code imports no framework (Hono), no Bun api, no adapter,
 *    no application, no platform and no runtime.
 * 8. The application uses the public entry points of the domains and the
 *    observation interfaces, never a concrete adapter.
 * 9. The platform implements the ports of the domains, it makes no policy
 *    decision and it knows neither the application nor the runtime.
 * 10. The observation layer is independent of everything else.
 * 11. The runtime is the composition root: it may assemble everything.
 * 12. There are no catch-all directories and no import cycles.
 * 13. The framework of the application belongs to the application and the
 *     api of the runtime belongs to the platform of the runtime.
 * 14. The source imports no directory that is not part of the service:
 *     the reference implementation of the protocol of access and the
 *     fixtures of the tests are not part of the gateway.
 *
 * The rules themselves are the engine of `tooling/architecture.ts`, and
 * the matrix below is what makes them the rules of the gateway.
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

/** The domains of the gateway and the domains they may use. */
export const DOMAIN_DEPENDENCIES: Record<string, readonly string[]> = {
  routing: [],
  configuration: ['routing', 'authentication'],
  authentication: [],
  'workspace-access': ['authentication', 'routing'],
  forwarding: ['authentication'],
  'rate-limiting': [],
  proxying: ['forwarding'],
  websockets: ['forwarding'],
  control: ['configuration', 'authentication', 'workspace-access'],
}

/** The rules of the boundaries of the gateway. */
export const RULES: ArchitectureRules = {
  domainDependencies: DOMAIN_DEPENDENCIES,
  entryPoints: ['src/main.ts', 'src/control-main.ts'],
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
  // The directory of the reference implementation of the protocol of
  // access and of the fixtures of the tests. The gateway is not the
  // access service, and a fixture that carries accounts with known
  // passwords is not part of the image of the gateway.
  forbiddenImportDirectories: ['services'],
}

/** The location of a file in the layers of the source of the gateway. */
export function locate(path: string): ReturnType<typeof locateOf> {
  return locateOf(path, RULES)
}

/** Checks the import boundaries of the source of the gateway. */
export function checkArchitecture(files: SourceFile[]): Violation[] {
  return check(files, RULES)
}

/** Reports the files of the source of the gateway that are in no known layer. */
export function unlocatedFiles(files: SourceFile[]): string[] {
  return unlocatedOf(files, RULES)
}

/** Reports the directories of the source of the gateway that collect unrelated behaviour. */
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
