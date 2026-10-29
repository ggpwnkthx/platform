/**
 * The failure of a command.
 *
 * A command of the CLI fails in a way a script can read: the status of
 * the process tells the script what kind of failure it was, and the
 * answer of the CLI carries the code of the service that refused. The
 * code of a service is the truth, and the status of the process is the
 * coarse truth: a script branches on the status, and a human reads the
 * code.
 *
 * The statuses are the ones of the services: a refusal of a policy is a
 * refusal, and it is not a crash of the client.
 */

/** The status of the process when a command fails. */
export type ExitCode =
  /** The command did what it was asked. */
  | 0
  /** The command failed, and the reason is not one of the ones below. */
  | 1
  /** The command was asked something it cannot answer: a wrong flag, a missing argument. */
  | 2
  /** The caller is not authenticated, or its credential is no longer valid. */
  | 3
  /** The thing the command names is not there. */
  | 4
  /** The thing the command names is there, and it changed under it. */
  | 5
  /** A policy refused the command. */
  | 6
  /** A service of the deployment could not be reached. */
  | 7
  /** The request was refused because it was not a valid one. */
  | 8

/** The failure of a command. */
export class CliFailure extends Error {
  /** The status the process ends with. */
  readonly exit: ExitCode
  /** The code of the refusal, when a service refused the command. */
  readonly code: string
  /** The details of the refusal, when the service sent some. */
  readonly details: unknown

  /**
   * The failure of a command.
   *
   * @param message what the reader is told.
   * @param exit the status the process ends with.
   * @param code the code of the refusal.
   * @param details the details of the refusal.
   */
  constructor(message: string, exit: ExitCode = 1, code = 'failed', details?: unknown) {
    super(message)
    this.name = 'CliFailure'
    this.exit = exit
    this.code = code
    this.details = details
  }
}

/**
 * The statuses of the process that carry a refusal of a service.
 *
 * The table is the table of the data API (docs/data/api.md), and the
 * codes of the other services are read the same way: the code decides,
 * and the status is the answer of the service.
 */
const BY_STATUS: Record<number, ExitCode> = {
  400: 8,
  401: 3,
  403: 6,
  404: 4,
  409: 5,
  412: 5,
  422: 8,
  428: 5,
  429: 1,
  503: 7,
  504: 7,
}

/** The codes of the services that name a status of their own. */
const BY_CODE: Record<string, ExitCode> = {
  INVALID_REQUEST: 8,
  INVALID_QUERY: 8,
  INVALID_CURSOR: 8,
  INVALID_PRECONDITION: 8,
  VALIDATION_FAILED: 8,
  INVALID_REFERENCE: 8,
  UNAUTHENTICATED: 3,
  FORBIDDEN: 6,
  NOT_FOUND: 4,
  CONFLICT: 5,
  IDEMPOTENCY_CONFLICT: 5,
  OPERATION_IN_PROGRESS: 5,
  CURSOR_STALE: 5,
  PRECONDITION_FAILED: 5,
  PRECONDITION_REQUIRED: 5,
  TOO_MANY_REQUESTS: 1,
  INTERNAL_ERROR: 1,
  AUTHORIZATION_UNAVAILABLE: 7,
  DATABASE_UNAVAILABLE: 7,
  OVERLOADED: 7,
  DRAINING: 7,
  DEADLINE_EXCEEDED: 7,
  unauthorized: 3,
  invalid_client: 3,
  invalid_grant: 3,
  workspace_forbidden: 6,
  tenant_disabled: 6,
  principal_disabled: 6,
  identity_rejected: 6,
  identity_unknown: 6,
  access_unavailable: 7,
  service_unavailable: 7,
  not_found: 4,
  no_route: 4,
  not_ready: 7,
  conflict: 5,
  invalid_request: 8,
}

/**
 * The status the process ends with, for a refusal of a service.
 *
 * The code of the service decides when it is one the table knows, and
 * the status of the answer decides otherwise.
 *
 * @param status the status of the answer of the service.
 * @param code the code of the refusal, when the service sent one.
 */
export function exitCodeOf(status: number, code?: string): ExitCode {
  if (code) {
    const known = BY_CODE[code.toUpperCase()] ?? BY_CODE[code]
    if (known !== undefined) return known
  }
  return BY_STATUS[status] ?? 1
}
