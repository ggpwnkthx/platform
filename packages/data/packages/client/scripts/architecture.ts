#!/usr/bin/env bun
/**
 * The architecture check of the client.
 *
 * The client is published: it is installed by the consumers of the
 * backend, outside of this repository, and it has to work there on its
 * own. The rules of the client are therefore stricter than the rules of
 * a service:
 *
 * 1. The client has **no dependency**: it imports no package. A client
 *    that imports a package drags that package into the tree of every
 *    consumer, and a dependency that is not needed at runtime is a
 *    dependency that breaks.
 * 2. The client imports **nothing of the service**: the source of the
 *    backend is not published, and a relative import that leaves the
 *    directory of the client cannot resolve in the package that is
 *    published.
 * 3. The modules of the client have **no cycle**: a cycle is a pair of
 *    files that cannot be read on their own, and a generated file of
 *    the deployment cannot take part in one.
 *
 * The engine of the check is `tooling/client-architecture.ts`, and the
 * client of the console and of the CLI uses it too.
 *
 * The command prints the problems and exits with a status of 1 when
 * there is one.
 */

import { resolve } from 'node:path'
import {
  checkClientArchitecture,
  STANDALONE_RULES,
} from '../../../../../tooling/client-architecture'

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
