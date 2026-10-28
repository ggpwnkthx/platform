/**
 * The context of a request of the console: the variables the middleware
 * sets and the properties of a page.
 */

import type { OperatorScope } from '../domains/operators'
import type { Session } from '../domains/session'
import type { Services } from '../runtime/services'

/** A step of the breadcrumbs of a page. */
export interface Crumb {
  readonly label: string
  readonly href?: string
}

/** The sections of the console. */
export type Section = 'home' | 'workspaces' | 'operators' | 'status' | 'docs' | 'me'

/** The properties of a page. */
export interface PageProps {
  readonly title: string
  readonly section?: Section
  readonly crumbs?: readonly Crumb[]
}

declare module 'hono' {
  interface ContextVariableMap {
    services: Services
    session: Session | null
    requestId: string
    scope: OperatorScope
  }
  interface ContextRenderer {
    // biome-ignore lint/style/useShorthandFunctionType: the renderer of Hono is augmented by declaration merging, which a type alias cannot do.
    (content: string | Promise<string>, props: PageProps): Response | Promise<Response>
  }
}
