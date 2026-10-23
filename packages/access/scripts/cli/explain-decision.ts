#!/usr/bin/env bun
/**
 * The plan of the decision query.
 *
 * The script fills a database with grants and prints the plan of the
 * statement of the decision (spec §8.3). The plan is the evidence that
 * the query uses the index of the specification (§8.5) and not a scan of
 * the table.
 *
 *   ACCESS_DATABASE_URL=postgres://… bun run scripts/explain-decision.ts
 */
import { createLogger } from '../../src/observability'
import { openToolDatabase, seedToolTenant } from '../support/database'
import { failure } from '../support/report'

/** How many principals the data set holds. */
const PRINCIPALS = Number(process.env.ACCESS_EXPLAIN_PRINCIPALS ?? '1000')
/** How many grants every principal holds. */
const GRANTS = Number(process.env.ACCESS_EXPLAIN_GRANTS ?? '1000')

const logger = createLogger({ level: 'info', bindings: { service: 'access', tool: 'explain' } })

async function main(): Promise<void> {
  const database = await openToolDatabase()
  try {
    logger.info('the data set is filled', { principals: PRINCIPALS, grants: GRANTS })
    await seedToolTenant(database, {
      slug: 'explain',
      displayName: 'Explain',
      issuer: 'https://login.explain.example',
      clientId: 'access-explain',
    })
    await database.exec(`
      insert into users (tenant_id, external_subject)
      select (select id from tenants where slug = 'explain'), 'subject-' || g
      from generate_series(1, ${PRINCIPALS}) g
      on conflict do nothing;
    `)
    await database.exec(`
      insert into grants (tenant_id, user_id, permission_id, workspace_id, route_id)
      select (select id from tenants where slug = 'explain'),
             u.id,
             (select id from permissions where key = 'workspace.read' limit 1),
             'workspace-' || w,
             'workspace-api'
      from users u
      cross join generate_series(1, ${GRANTS}) w
      where u.external_subject like 'subject-%'
      on conflict do nothing;
    `)

    const count = await database.query<{ count: number }>(
      'select count(*)::int as count from grants'
    )
    logger.info('the data set is ready', { grants: count[0]?.count })

    // The subject of the plan is a principal that exists and that holds a
    // thousand grants: the plan of the statement has to be the plan of the
    // real one.
    const subject = await database.query<{ id: string }>(
      `select id from users where external_subject = 'subject-1' limit 1`
    )
    const subjectId = subject[0]?.id ?? '00000000-0000-0000-0000-000000000000'

    const plan = await database.query<Record<string, unknown>>(
      `explain (analyze, buffers)
       select
         true as principal_exists,
         u.status = 'active' as principal_active,
         t.enabled as tenant_enabled,
         (g.id is not null and (g.expires_at is null or g.expires_at > now())) as live_grant,
         (g.id is not null and g.expires_at is not null and g.expires_at <= now()) as expired_grant,
         t.slug as tenant_slug
       from users u
       join tenants t on t.id = u.tenant_id
       left join lateral (
         select g.id, g.expires_at
         from grants g
         join permissions p on p.id = g.permission_id
         where g.user_id = u.id
           and g.revoked_at is null
           and p.enabled
           and (g.workspace_id is null or g.workspace_id = $2)
           and (g.route_id is null or g.route_id = $3)
         order by (g.expires_at is null or g.expires_at > now()) desc
         limit 1
       ) g on true
       where u.id = $1`,
      [subjectId, 'workspace-1', 'workspace-api']
    )
    for (const row of plan) {
      console.log(JSON.stringify(row))
    }
  } finally {
    await database.close()
  }
}

main().catch(failure('the plan could not be read'))
