/**
 * The client of the contract of the access context.
 *
 * The console reads the keys that Access holds for the
 * caller on the route of the console, with the credential of the
 * contract (docs/access/spec.md §9). The scope of an operator is read,
 * never assumed: the keys of the token of the caller are a snapshot of
 * the moment of the login, and the context is the policy of now.
 *
 * A context is kept until its `validUntil`, and never longer.
 */

import { AccessContextClient as PlatformContextClient } from '@platform/client'
import { transportOf, type Fetch } from '../transport'
import { failureOf } from './errors'
import type { AccessContext } from './types'

/** The options of the client of the access context. */
export interface ContextClientOptions {
  readonly accessUrl: string
  readonly credential: string
  readonly timeoutMs: number
  readonly fetch?: Fetch
  readonly clock?: () => number
}

/** The question the console asks. */
export interface ContextQuestion {
  readonly subject: string
  readonly tenantId: string
  readonly workspaceId: string
  readonly routeId: string
}

/** The client of the contract of the access context. */
export class ContextClient {
  readonly #client: PlatformContextClient

  constructor(options: ContextClientOptions) {
    this.#client = new PlatformContextClient({
      baseUrl: options.accessUrl,
      credential: options.credential,
      transport: transportOf('Access', options.fetch ?? fetch, options.timeoutMs),
      ...(options.clock ? { clock: options.clock } : {}),
    })
  }

  /** The context of a principal, fresh or from the cache when it is still valid. */
  async context(
    question: ContextQuestion,
    options: { fresh?: boolean } = {}
  ): Promise<AccessContext> {
    try {
      return await this.#client.context(question, options)
    } catch (error) {
      throw failureOf(error)
    }
  }
}
