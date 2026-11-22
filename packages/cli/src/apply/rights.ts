import {
  type PolicyCommand,
  grantStatement,
  ident,
  policyStatement,
  qualified,
  schemaPrivilegeNames,
  schemaStatement,
  tablePrivilegeNames,
  workspaceTarget,
} from '@platform/vocabulary'
import { applyCollections, describeItem } from '../model.ts'
import type { Run } from './run.ts'
import type { Grant, Policy, Workspace } from './schema.ts'

/** A privilege is granted on a collection or on the workspace, and never on both. */
async function applyGrant(run: Run, schema: string, grant: Grant): Promise<void> {
  const allowed = (
    grant.collection ? tablePrivilegeNames : schemaPrivilegeNames
  ) as readonly string[]
  const wrong = grant.privileges.filter((p) => !allowed.includes(p))
  const on = grant.collection ? `${schema}.${grant.collection}` : `workspace ${schema}`
  if (wrong.length) throw new Error(`${wrong.join(', ')} cannot be granted on ${on}`)
  if (grant.columns && !grant.collection)
    throw new Error(`Columns need a collection: grant on ${on}`)
  const sql = grantStatement(
    {
      schema,
      table: grant.collection ?? null,
      privileges: grant.privileges,
      columns: grant.columns ?? [],
      grantee: grant.to,
      withGrantOption: false,
    },
    grant.state === 'absent'
  )
  if (!grant.collection)
    return run.converge(
      sql,
      'SELECT nspacl::text AS acl FROM pg_namespace WHERE nspname=$1',
      [schema],
      [sql]
    )
  await run.converge(
    sql,
    `SELECT c.relacl::text AS acl, ARRAY(SELECT a.attacl::text FROM pg_attribute a
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns
        FROM pg_class c WHERE c.oid=to_regclass($1)`,
    [qualified(schema, grant.collection)],
    [sql]
  )
}

/** A policy's command cannot be altered, so it is replaced; the transaction hides the gap. */
async function applyPolicy(run: Run, schema: string, policy: Policy): Promise<void> {
  const target = `${ident(policy.name)} ON ${qualified(schema, policy.collection)}`
  const statements = [`DROP POLICY IF EXISTS ${target}`]
  if (policy.state === 'present')
    statements.push(
      policyStatement({
        schema,
        table: policy.collection,
        name: policy.name,
        permissive: !policy.restrictive,
        command: policy.for.toUpperCase() as PolicyCommand,
        roles: policy.to,
        using: policy.using ?? '',
        check: policy.check ?? '',
      })
    )
  await run.converge(
    `${policy.state === 'present' ? 'set' : 'drop'} policy ${policy.name} on ${schema}.${policy.collection}`,
    `SELECT permissive,roles::text,cmd,qual,with_check FROM pg_policies
        WHERE schemaname=$1 AND tablename=$2 AND policyname=$3`,
    [schema, policy.collection, policy.name],
    statements
  )
}

/** A workspace: its owner, its collections, and everything granted and policed inside it. */
export async function applyWorkspace(run: Run, w: Workspace): Promise<void> {
  const q = run.q
  const found = await q.query(
    'SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname=$1',
    [w.slug]
  )
  const owner = found.rows[0]?.owner
  if (owner && w.owner && owner !== w.owner)
    throw new Error(`Workspace ${w.slug} is owned by ${owner}, not ${w.owner}`)
  // Its owner builds collections with the platform's helper, which platform_users may call.
  const able =
    !w.owner ||
    (await q.query("SELECT pg_has_role($1,'platform_users','USAGE') AS ok", [w.owner])).rows[0].ok
  if (!able) await run.member(w.owner!, 'platform_users')
  if (owner) run.same()
  else {
    await q.query(schemaStatement(w.slug, w.owner ?? null))
    run.changed(`create workspace ${w.slug}${w.owner ? ` owned by ${w.owner}` : ''}`)
  }
  // Everything inside is made as the owner, so that it owns it and its grants are its own.
  // fallow-ignore-next-line security-sink -- the role name is quoted with ident(); the manifest is the operator's own
  if (w.owner) await q.query(`SET LOCAL ROLE ${ident(w.owner)}`)
  await describeItem(q, workspaceTarget(w.slug), w.metadata, run)
  await applyCollections(q, w.slug, w.collections, w.relations, run)
  for (const grant of w.grants) await applyGrant(run, w.slug, grant)
  for (const policy of w.policies) await applyPolicy(run, w.slug, policy)
  if (w.owner) await q.query('RESET ROLE')
}
