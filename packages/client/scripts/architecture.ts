#!/usr/bin/env bun
/**
 * The architecture check of the client.
 *
 * The client of the platform is a library: the console and the CLI
 * import it, and it speaks to the services of the platform over HTTP.
 * The rules it obeys are the rules of every client of the platform:
 *
 * 1. The client has **no dependency**: it imports no package. A client
 *    that imports a package drags that package into the tree of every
 *    consumer, and the console and the CLI have dependencies of their
 *    own.
 * 2. The client imports **nothing of another workspace**: the source
 *    of a service is not a dependency of a client, and the contract of
 *    a service is read here, in the shapes of the contracts.
 * 3. The modules of the client have **no cycle**: a cycle is a pair of
 *    files that cannot be read on their own.
 * 4. The client has **no catch-all directory**: a directory that
 *    collects unrelated behaviour is a directory that nobody owns.
 *
 * The engine of the check is `tooling/client-architecture.ts`, and the
 * published client of Data uses it too.
 *
 * The command prints the problems and exits with a status of 1 when
 * there is one.
 */

import { resolve } from 'node:path'
import { checkClientArchitecture, STANDALONE_RULES } from '../../../tooling/client-architecture'

/** The root of the source of the client. */
const SOURCE = resolve(import.meta.dir, '..', 'src')

if (import.meta.main) {
  const problems = await checkClientArchitecture(SOURCE, STANDALONE_RULES)
  if (problems.length === 0) {
    console.log(JSON.stringify({ level: 'info', msg: 'the architecture of the client is valid' }))
  } else {
    for (const problem of problems) {
      console.error(`${problem.file}: ${problem.message}`)
    }
    process.exit(1)
  }
}
