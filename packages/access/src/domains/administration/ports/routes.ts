/**
 * The port of the routes of the logins.
 *
 * The domain owns the rules of the routes; the storage is a port that
 * the composition root fulfils. The domain knows nothing about
 * PostgreSQL and nothing about the shape of the rows.
 *
 * A route names the tenant of a login and the provider the login signs
 * in at (§3.13). A route is a hint that the platform proves before it
 * routes anything, and the proof is one of two: the owner of the domain
 * publishes a record that carries the challenge of the route, or the
 * operator of the platform says so.
 */

import type { ChangeAudit } from './audit'
import type { Scope } from './scope'

/** The kind of the key of a route. */
export type RouteKind = 'domain' | 'address'

/** The state of a route. */
export type RouteStatus = 'pending' | 'verified' | 'rejected'

/** The method of the verification of a route. */
export type RouteVerification = 'dns' | 'operator'

/** A route of a login. */
export interface Route {
  id: string
  /** The kind of the key of the route. */
  kind: RouteKind
  /** The key of the route: the domain, or the address. */
  key: string
  /** The slug of the tenant the route names. */
  tenant: string
  /** The provider of the tenant the login signs in at; null is its default. */
  provider: string | null
  /** The state of the route: only a verified one routes a login. */
  status: RouteStatus
  /** The method of the verification, when the route is verified. */
  verification: RouteVerification | null
  /** The token the owner of the domain publishes to prove that it owns it. */
  challenge: string
  /** The moment the route was verified. */
  verifiedAt: Date | null
  /** The operator that verified the route. */
  verifiedBy: string | null
  createdAt: Date
}

/** The registration of a route. */
export interface RouteRegistration {
  /** The kind of the key of the route. Default `domain`. */
  kind?: RouteKind
  /** The key of the route: the domain, or the address. */
  key: string
  /** The slug of the tenant the route names. */
  tenant: string
  /** The provider of the tenant the login signs in at; null is its default. */
  provider?: string | null
}

/** The filter of the list of the routes. */
export interface RouteFilter {
  /** The id of the tenant, or null for every tenant. */
  tenantId: string | null
  /** The kind of the key, or null for every kind. */
  kind: RouteKind | null
  /** The size of the page. */
  limit: number
  /** The number of rows that are skipped. */
  offset: number
}

/** A page of routes and the number of the routes that match. */
export interface RoutePage {
  routes: Route[]
  /** The number of routes that match the filter, the page included. */
  total: number
  /** The size of the page that was asked for. */
  limit: number
  /** The number of rows that were skipped. */
  offset: number
}

/** The storage of the routes. */
export interface RouteStore {
  /**
   * The route of an id.
   *
   * The scope is the scope of the call: the route of another tenant is
   * not a route the statement may read (§3.10).
   */
  findById(id: string, scope: Scope): Promise<Route | null>
  /** The route of a key, whatever its state. */
  findByKey(kind: RouteKind, key: string, scope: Scope): Promise<Route | null>
  /** The routes that match a filter, and their number. */
  list(filter: RouteFilter): Promise<RoutePage>
  /**
   * Creates a route.
   *
   * The row of the audit of the change is written by the same statement
   * as the route: a route that is not audited does not exist.
   */
  create(
    registration: {
      kind: RouteKind
      key: string
      tenantId: string
      providerSlug: string | null
      challenge: string
      /** The state of the route. Default `pending`: a route waits for its proof. */
      status?: RouteStatus
    },
    audit: ChangeAudit
  ): Promise<Route>
  /**
   * Changes a route, and writes the row of its audit with it.
   *
   * A route that names another tenant waits for its proof again: the
   * proof is about the domain, and the tenant is who owns it.
   */
  update(
    id: string,
    changes: { tenantId: string; providerSlug: string | null },
    scope: Scope,
    audit: ChangeAudit
  ): Promise<Route | null>
  /**
   * Verifies a route, or refuses it.
   *
   * The row of the audit of the change is written by the same statement
   * as the route.
   */
  verify(
    id: string,
    input: {
      status: RouteStatus
      verification: RouteVerification
      verifiedBy: string | null
    },
    scope: Scope,
    audit: ChangeAudit
  ): Promise<Route | null>
}

/**
 * The proof of a domain (spec §10.18).
 *
 * The owner of a domain proves that it owns it by publishing a record
 * that carries the challenge of the route. The domain never reads the
 * resolver itself: the port is what the composition root fulfils, and a
 * deployment that resolves no name answers that no domain is proven.
 */
export interface DomainProof {
  /** The values of the TXT records of a name. */
  txtOf(name: string): Promise<readonly string[]>
}
