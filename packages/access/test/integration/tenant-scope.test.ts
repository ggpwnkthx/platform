/**
 * The scope of the tenant in the rule of the decision (spec §6.5, §8.3).
 *
 * A route that names no workspace is a call of the tenant: the gateway
 * asks Access about the route and the request carries no workspace. A
 * grant that names the tenant itself — its slug is the workspace it
 * names — holds on such a request, and the capability that creates a
 * workspace of the tenant is held that way (spec §6.5).
 *
 * The grant of a workspace does not hold on it: a request that names no
 * workspace is not about a workspace of the tenant, and the tenant
 * administration does not reach the records of a workspace because it
 * administers the tenant.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { openTestDatabase } from './database'
import { decide } from '../../src/domains/authorization'
import { DecisionRepository } from '../../src/platform/postgres'
import type { Database } from '../../src/platform/postgres'

let database: Database

/** The tenant of the tests. */
const TENANT = {
  slug: 'acme',
  /** The workspace of the tenant, in the routes of the data. */
  workspaceId: '44444444-4444-4444-8444-444444444444',
} as const

/** The identifier of the tenant of the tests. */
let tenantId: string

/** The permission of the grants of the tests. */
let permissionId: string

beforeAll(async () => {
  database = await openTestDatabase()
  const tenant = await database.query<{ id: string }>(
    `insert into tenants (slug, display_name, idp_issuer, idp_client_id, idp_client_secret,
       idp_redirect_uri, client_id, client_secret)
     values ($1, $1, 'https://login.example.com', $2, $3, 'https://access.example.com/cb', $4, $3)
     returning id`,
    [TENANT.slug, 'access-acme', Buffer.from('secret'), 'gateway-acme']
  )
  tenantId = tenant[0]!.id
  const permission = await database.query<{ id: string }>(
    `insert into permissions (tenant_id, key) values ($1, $2) returning id`,
    [tenantId, 'data.workspace.create']
  )
  permissionId = permission[0]!.id
})

afterAll(async () => {
  await database.close()
})

/**
 * Gives a principal a grant.
 *
 * @param database the database of the tests.
 * @param subject the subject of the principal.
 * @param workspaceId the workspace of the grant, or null for every workspace.
 * @param routeId the route of the grant, or null for every route.
 */
async function grant(
  database: Database,
  subject: string,
  workspaceId: string | null,
  routeId: string | null
): Promise<void> {
  await database.query(
    `insert into grants (tenant_id, user_id, permission_id, workspace_id, route_id)
       values ($1, $2, $3, $4, $5)`,
    [tenantId, subject, permissionId, workspaceId, routeId]
  )
}

/** A principal of the tenant of the tests. */
async function principal(name: string): Promise<string> {
  const rows = await database.query<{ id: string }>(
    `insert into users (tenant_id, external_subject) values ($1, $2) returning id`,
    [tenantId, name]
  )
  return rows[0]!.id
}

describe('the scope of the tenant', () => {
  test('a grant that names the tenant holds on a request that names no workspace', async () => {
    const repository = new DecisionRepository(database, 5_000)
    const subject = await principal('the-admin')
    await grant(database, subject, TENANT.slug, null)

    const facts = await repository.decide({
      subject,
      // The route names no workspace: the request carries none.
      workspaceId: '',
      routeId: 'workspaces',
      roles: [],
    })
    expect(decide(facts).allow).toBe(true)
  })

  test('a grant that names no workspace holds on a request that names no workspace', async () => {
    const repository = new DecisionRepository(database, 5_000)
    const subject = await principal('the-everywhere')
    await grant(database, subject, null, null)

    const facts = await repository.decide({
      subject,
      workspaceId: '',
      routeId: 'workspaces',
      roles: [],
    })
    expect(decide(facts).allow).toBe(true)
  })

  test('a grant that names the tenant does not hold on a request that names a workspace', async () => {
    const repository = new DecisionRepository(database, 5_000)
    const subject = await principal('the-tenant-admin')
    await grant(database, subject, TENANT.slug, null)

    const facts = await repository.decide({
      subject,
      workspaceId: TENANT.workspaceId,
      routeId: 'data-api',
      roles: [],
    })
    expect(decide(facts).allow).toBe(false)
  })

  test('a grant that names another tenant does not hold on the scope of a tenant', async () => {
    const repository = new DecisionRepository(database, 5_000)
    const subject = await principal('the-stranger')
    await grant(database, subject, 'other-tenant', null)

    const facts = await repository.decide({
      subject,
      workspaceId: '',
      routeId: 'workspaces',
      roles: [],
    })
    expect(decide(facts).allow).toBe(false)
  })
})
