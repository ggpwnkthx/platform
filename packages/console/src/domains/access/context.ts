/**
 * The client of the contract of the access context.
 *
 * The console reads the keys that the access service holds for the
 * caller on the route of the console, with the credential of the
 * contract (docs/access/spec.md §9). The scope of an operator is read,
 * never assumed: the keys of the token of the caller are a snapshot of
 * the moment of the login, and the context is the policy of now.
 *
 * A context is kept until its `validUntil`, and never longer.
 */

import { bodyOf, call, type Fetch } from '../transport'
import { refusalOf } from './errors'
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
  readonly #options: ContextClientOptions
  readonly #fetch: Fetch
  readonly #clock: () => number
  readonly #cache = new Map<string, { context: AccessContext; until: number }>()

  constructor(options: ContextClientOptions) {
    this.#options = options
    this.#fetch = options.fetch ?? fetch
    this.#clock = options.clock ?? Date.now
  }

  /** The context of a principal, fresh or from the cache when it is still valid. */
  async context(
    question: ContextQuestion,
    options: { fresh?: boolean } = {}
  ): Promise<AccessContext> {
    const key = [question.subject, question.tenantId, question.workspaceId, question.routeId].join(
      '\u0000'
    )
    const now = this.#clock()
    const cached = this.#cache.get(key)
    if (!options.fresh && cached && cached.until > now) return cached.context

    const response = await call(
      'access service',
      this.#fetch,
      `${this.#options.accessUrl}/v1/access-context`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#options.credential}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ version: 1, ...question }),
      },
      this.#options.timeoutMs
    )
    if (!response.ok) throw await refusalOf(response)
    const body = (await bodyOf(response)) as Record<string, unknown> | null
    const context: AccessContext = {
      allow: body?.allow === true,
      permissionKeys: Array.isArray(body?.permissionKeys)
        ? body.permissionKeys.filter((key): key is string => typeof key === 'string')
        : [],
      validUntil: typeof body?.validUntil === 'string' ? body.validUntil : null,
    }
    if (context.allow && context.validUntil) {
      const until = Date.parse(context.validUntil)
      if (Number.isFinite(until)) this.#cache.set(key, { context, until })
    } else {
      this.#cache.delete(key)
    }
    return context
  }
}
