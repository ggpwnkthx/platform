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

/** The question of the contract of the access context. */
const QUESTION = {
  subject: 'the-subject',
  tenantId: 'the-tenant',
  workspaceId: 'the-workspace',
  routeId: 'the-route',
}

/**
 * An answer of the contract of the access context, in the shape the
 * contract holds.
 *
 * The shape is the one of Access: the version, the decision, the four
 * identifiers of the question, the permission keys, the moment of the
 * evaluation and the moment the answer stops being valid.
 */
function contextAnswer(overrides: Record<string, unknown> = {}): string {
  const now = Date.now()
  return JSON.stringify({
    version: 1,
    allow: true,
    subject: QUESTION.subject,
    tenantId: QUESTION.tenantId,
    workspaceId: QUESTION.workspaceId,
    routeId: QUESTION.routeId,
    permissionKeys: ['workspace.read'],
    evaluatedAt: new Date(now).toISOString(),
    validUntil: new Date(now + 4_000).toISOString(),
    ...overrides,
  })
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
      'POST https://access.example.test/v1/access-context': ok(contextAnswer()),
    })
    const client = new AccessContextClient({ ...OPTIONS, transport })
    const context = await client.context(QUESTION)
    expect(context.allow).toBe(true)
    expect(context.permissionKeys).toEqual(['workspace.read'])
    expect(calls[0]?.body).toContain('"version":1')
  })

  test('an answer that is already expired is refused', async () => {
    // The answer is the shape of the contract and it is spent: a
    // console that used it would act on an authorization that Access
    // took back.
    const expired = new Date(Date.now() - 1_000).toISOString()
    const { transport } = transportOf({
      'POST https://access.example.test/v1/access-context': ok(
        contextAnswer({ evaluatedAt: expired, validUntil: expired })
      ),
    })
    const client = new AccessContextClient({ ...OPTIONS, transport })
    await expect(client.context(QUESTION)).rejects.toThrow('expired')
  })

  test('an answer that names another subject is refused', async () => {
    const { transport } = transportOf({
      'POST https://access.example.test/v1/access-context': ok(
        contextAnswer({ subject: 'another-subject' })
      ),
    })
    const client = new AccessContextClient({ ...OPTIONS, transport })
    await expect(client.context(QUESTION)).rejects.toThrow('another subject')
  })

  test('an answer that carries no moment of validity is refused', async () => {
    const { transport } = transportOf({
      'POST https://access.example.test/v1/access-context': ok(
        contextAnswer({ validUntil: undefined })
      ),
    })
    const client = new AccessContextClient({ ...OPTIONS, transport })
    await expect(client.context(QUESTION)).rejects.toThrow('validity')
  })

  test('an answer that is valid for longer than the contract allows is refused', async () => {
    const now = Date.now()
    const { transport } = transportOf({
      'POST https://access.example.test/v1/access-context': ok(
        contextAnswer({
          evaluatedAt: new Date(now).toISOString(),
          validUntil: new Date(now + 3_600_000).toISOString(),
        })
      ),
    })
    const client = new AccessContextClient({ ...OPTIONS, transport })
    await expect(client.context(QUESTION)).rejects.toThrow('longer than the contract allows')
  })

  test('an answer that allows without a permission key is refused', async () => {
    const { transport } = transportOf({
      'POST https://access.example.test/v1/access-context': ok(
        contextAnswer({ permissionKeys: [] })
      ),
    })
    const client = new AccessContextClient({ ...OPTIONS, transport })
    await expect(client.context(QUESTION)).rejects.toThrow('without a single permission key')
  })

  test('an answer of another version is refused', async () => {
    const { transport } = transportOf({
      'POST https://access.example.test/v1/access-context': ok(contextAnswer({ version: 2 })),
    })
    const client = new AccessContextClient({ ...OPTIONS, transport })
    await expect(client.context(QUESTION)).rejects.toThrow('unknown version')
  })

  test('the context of a principal is kept until it is spent', async () => {
    let calls = 0
    const transport: ClientTransport = {
      send: async () => {
        calls += 1
        return ok(contextAnswer())
      },
    }
    const client = new AccessContextClient({ ...OPTIONS, transport })
    await client.context(QUESTION)
    await client.context(QUESTION)
    expect(calls).toBe(1)
    await client.context(QUESTION, { fresh: true })
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
