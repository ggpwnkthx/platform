import { describe, expect, test } from 'bun:test'
import { AccessAdminClient, AccessContextClient, decide } from '../src/access'
import type { ClientAnswer, ClientRequest, ClientTransport } from '../src/transport'

/**
 * The clients of Access.
 *
 * The console administers Access with the credential of an operator, and
 * the CLI asks it the same questions. The client is handed the
 * credential, and it never chooses it.
 */

/** A transport that records the calls it is given and answers them. */
function transportOf(answers: Record<string, ClientAnswer>): {
  transport: ClientTransport
  calls: ClientRequest[]
} {
  const calls: ClientRequest[] = []
  const transport: ClientTransport = {
    send: async (request) => {
      calls.push(request)
      const answer = answers[`${request.method} ${request.url}`]
      if (!answer) throw new Error(`the call ${request.method} ${request.url} was not expected`)
      return answer
    },
  }
  return { transport, calls }
}

/** The answer of a successful call. */
function ok(body: string, status = 200): ClientAnswer {
  return { status, headers: {}, body }
}

const OPTIONS = {
  baseUrl: 'https://access.example.test',
  credential: 'the-credential',
}

describe('the clients of Access', () => {
  test('the path of the administration carries the version', async () => {
    const { transport, calls } = transportOf({
      'GET https://access.example.test/v1/admin/tenants': ok('{"tenants":[]}'),
    })
    const client = new AccessAdminClient({ ...OPTIONS, transport })
    await client.tenants()
    expect(calls[0]?.url).toBe('https://access.example.test/v1/admin/tenants')
  })

  test('the credential of the operator travels in the headers', async () => {
    const { transport, calls } = transportOf({
      'GET https://access.example.test/v1/admin/tenants': ok('{"tenants":[]}'),
    })
    const client = new AccessAdminClient({ ...OPTIONS, transport })
    await client.tenants()
    expect(calls[0]?.headers?.authorization).toBe('Bearer the-credential')
  })

  test('a page of the administration is read', async () => {
    const { transport } = transportOf({
      'GET https://access.example.test/v1/admin/users?tenant=acme': ok(
        '{"principals":[{"id":"1"}],"total":1,"limit":20,"offset":0}'
      ),
    })
    const client = new AccessAdminClient({ ...OPTIONS, transport })
    const page = await client.principals({ tenant: 'acme' })
    expect(page.rows).toHaveLength(1)
    expect(page.total).toBe(1)
  })

  test('the creation of a tenant is told from the update of it', async () => {
    const { transport } = transportOf({
      'POST https://access.example.test/v1/admin/tenants': ok('{"id":"1"}', 201),
    })
    const client = new AccessAdminClient({ ...OPTIONS, transport })
    const saved = await client.saveTenant({
      slug: 'acme',
      displayName: 'Acme',
      issuer: 'https://idp.example.test',
      idpClientId: 'id',
      idpClientSecret: 'secret',
      clientId: 'client',
      clientSecret: 'secret',
    })
    expect(saved.created).toBe(true)
  })

  test('the refusal of the service is raised', async () => {
    const { transport } = transportOf({
      'GET https://access.example.test/v1/admin/tenants': {
        status: 403,
        headers: {},
        body: '{"error":"forbidden","message":"no"}',
      },
    })
    const client = new AccessAdminClient({ ...OPTIONS, transport })
    await expect(client.tenants()).rejects.toThrow('no')
  })

  test('the context of a principal is read', async () => {
    const { transport, calls } = transportOf({
      'POST https://access.example.test/v1/access-context': ok(
        '{"allow":true,"permissionKeys":["workspace.read"],"validUntil":"2030-01-01T00:00:00.000Z"}'
      ),
    })
    const client = new AccessContextClient({ ...OPTIONS, transport })
    const context = await client.context({
      subject: 'the-subject',
      tenantId: 'the-tenant',
      workspaceId: 'the-workspace',
      routeId: 'the-route',
    })
    expect(context.allow).toBe(true)
    expect(context.permissionKeys).toEqual(['workspace.read'])
    expect(calls[0]?.body).toContain('"version":1')
  })

  test('the context of a principal is kept until it is spent', async () => {
    let calls = 0
    const transport: ClientTransport = {
      send: async () => {
        calls += 1
        return ok('{"allow":true,"permissionKeys":[],"validUntil":"2030-01-01T00:00:00.000Z"}')
      },
    }
    const client = new AccessContextClient({ ...OPTIONS, transport })
    const question = {
      subject: 'the-subject',
      tenantId: 'the-tenant',
      workspaceId: 'the-workspace',
      routeId: 'the-route',
    }
    await client.context(question)
    await client.context(question)
    expect(calls).toBe(1)
    await client.context(question, { fresh: true })
    expect(calls).toBe(2)
  })

  test('the decision contract is asked with its own credential', async () => {
    const { transport, calls } = transportOf({
      'POST https://access.example.test/v1/decisions': ok('{"allow":true}'),
    })
    const answer = await decide(
      { ...OPTIONS, transport },
      { subject: 'the-subject' },
      'the-decision'
    )
    expect(answer).toEqual({ allow: true })
    expect(calls[0]?.headers?.authorization).toBe('Bearer the-decision')
  })
})
