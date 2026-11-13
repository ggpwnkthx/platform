#!/usr/bin/env bun
/**
 * The vocabulary of the permission keys (spec §3.3).
 *
 * The keys of the permissions are written in the code of the three
 * services that own them: Access decides who holds a key, Data decides
 * what a key grants, and the console reads the keys of the services and
 * draws them. The services share no code, so the vocabulary is written
 * three times, and a key that is renamed in one place and not in the
 * others is a key that one of the services does not know.
 *
 * The check holds the three copies of the vocabulary together:
 *
 * - the capabilities of the platform are the same keys in Access and in
 *   the console. A deployment that names a key of its own extends them,
 *   and the built-in ones are the same everywhere.
 * - the console knows no key that Access does not give: every key of
 *   the console is either a capability of the platform, which only the
 *   platform gives, or a key that the role of the administration of a
 *   tenant holds, which is what the console draws for an operator of a
 *   tenant.
 * - the key that opens the creation of a workspace is the same in Data
 *   and in the console.
 *
 *   bun run scripts/check-permission-keys.ts
 */

import { PLATFORM_PERMISSIONS } from '../packages/access/src/domains/administration/platform-permissions'
import { tenantAdminPermissions } from '../packages/access/src/domains/administration/tenant-admin'
import { WORKSPACE_CREATE } from '../packages/data/src/app/routes'
import {
  CONSOLE_KEYS,
  DATA_KEYS,
  PLATFORM_KEYS,
} from '../packages/console/src/domains/operators/scope'

/** The options of the administration, with the defaults of the deployment. */
const DEFAULT_ADMINISTRATION = {}

/** The problem of the vocabulary. */
export interface KeyProblem {
  /** What is wrong. */
  readonly message: string
}

/**
 * Checks the vocabulary of the permission keys.
 *
 * @returns the problems of the vocabulary; an empty list means that the
 *   three copies of the vocabulary are the same.
 */
export function checkPermissionKeys(): KeyProblem[] {
  const problems: KeyProblem[] = []
  const platformOfAccess = [...PLATFORM_PERMISSIONS].sort()
  const platformOfConsole = [...PLATFORM_KEYS].sort()

  // The capabilities of the platform are the same keys everywhere.
  if (platformOfAccess.join(',') !== platformOfConsole.join(',')) {
    problems.push({
      message:
        `the capabilities of the platform are "${platformOfAccess.join(', ')}" in Access and ` +
        `"${platformOfConsole.join(', ')}" in the console`,
    })
  }

  // The console knows no key that Access does not give.
  const tenantAdmin = [...tenantAdminPermissions(DEFAULT_ADMINISTRATION)].sort()
  const known = new Set([...tenantAdmin, ...platformOfAccess])
  for (const key of [...Object.values(CONSOLE_KEYS), ...Object.values(DATA_KEYS)]) {
    if (!known.has(key)) {
      problems.push({
        message: `the console knows the key "${key}", and Access gives it to nobody`,
      })
    }
  }

  // The key that opens the creation of a workspace is the same in Data
  // and in the console.
  if (!Object.values(DATA_KEYS).includes(WORKSPACE_CREATE)) {
    problems.push({
      message: `Data opens the creation of a workspace with the key "${WORKSPACE_CREATE}", and the console does not know it`,
    })
  }

  // Every key of the console that is not a capability of the platform is
  // a key that the administration of a tenant holds: the console draws
  // it for an operator of a tenant, and Access gives it to one.
  for (const key of [...Object.values(DATA_KEYS), ...Object.values(CONSOLE_KEYS)]) {
    if (platformOfAccess.includes(key)) continue
    if (!tenantAdmin.includes(key)) {
      problems.push({
        message: `the console knows the key "${key}", and the administration of a tenant does not hold it`,
      })
    }
  }

  return problems
}

if (import.meta.main) {
  const problems = checkPermissionKeys()
  if (problems.length === 0) {
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'the three copies of the vocabulary of the permission keys are the same',
      })
    )
  } else {
    for (const problem of problems) console.error(problem.message)
    console.error(`${problems.length} problems of the vocabulary of the permission keys`)
    process.exit(1)
  }
}
