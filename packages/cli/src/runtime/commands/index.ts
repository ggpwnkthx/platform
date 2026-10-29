/**
 * The commands of the CLI.
 *
 * The registry is the whole surface of the CLI: the commands of the
 * root, and the groups that hold the rest. The runtime is the only
 * place where the commands are assembled, and it is the place where the
 * ports of the platform are given to the core.
 */

import type { CommandSpec, GroupSpec } from '../../app/commands'
import { accessGroup } from './access'
import { contextGroup } from './context'
import { dataGroup } from './data'
import { doctor, login, logout, status, version, whoami } from './identity'
import { routesGroup, sessionsGroup } from './routes'

/** The commands of the root of the CLI. */
export const commands: readonly CommandSpec[] = [login, logout, whoami, status, version, doctor]

/** The groups of the commands. */
export const groups: readonly GroupSpec[] = [
  contextGroup,
  routesGroup,
  sessionsGroup,
  accessGroup,
  dataGroup,
]
