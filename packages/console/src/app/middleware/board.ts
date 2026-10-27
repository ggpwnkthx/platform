/**
 * The board of the status, for the caller of a request: its detail is
 * for the operators who hold `console.status`.
 */

import type { Context } from 'hono'
import { consoleAbility, CONSOLE_ACTIONS, CONSOLE_SUBJECT } from '../../domains/ability'
import { overallOf, type ServiceState, type ServiceStatus, summaryOf } from '../../domains/status'
import { operatorScope } from './scope'

/** The board of the status, as a page and its island read it. */
export interface Board {
  readonly overall: ServiceState
  readonly services: readonly ServiceStatus[]
  readonly detail: boolean
}

/** The board of the status, for the caller of a request. */
export async function boardOf(c: Context): Promise<Board> {
  const services = await c.get('services').probes()
  const detail = c.get('session')
    ? consoleAbility(await operatorScope(c)).can(CONSOLE_ACTIONS.status, CONSOLE_SUBJECT)
    : false
  return {
    overall: overallOf(services),
    services: detail ? services : services.map(summaryOf),
    detail,
  }
}
