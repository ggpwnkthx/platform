import type { Workspace } from './schema.ts'
import type { Run } from './run.ts'
import { applyCollections } from './collections.ts'
import { ident } from '../sql/kit.ts'
import { workspaceTarget } from '../sql/metadata.ts'
import { dropPolicyStatement, type PolicyCommand, policyStatement } from '../sql/policies.ts'
import { grantStatement, schemaPrivileges, tablePrivileges } from '../sql/privileges.ts'
import { schemaStatement } from '../sql/roles.ts'
/** A grant on a collection, and one on the workspace itself. */
async function applyGrant(run: Run, workspace: Workspace, grant: Workspace['grants'][number]) {
  const on = grant.collection
    ? `${workspace.slug}.${grant.collection}`
    : `workspace ${workspace.slug}`
  const allowed = (grant.collection ? tablePrivileges : schemaPrivileges) as readonly string[]
  const wrong = grant.privileges.filter((p) => p !== 'all' && !allowed.includes(p.toUpperCase()))
  if (wrong.length) throw new Error(`${wrong.join(', ')} cannot be granted on ${on}`)
  if (grant.columns && !grant.collection)
    throw new Error(`Columns need a collection: grant on ${on}`)
  const sql = grantStatement(
    {
      schema: workspace.slug,
      table: grant.collection ?? null,
      privileges: grant.privileges,
      columns: grant.columns,
      grantee: grant.to,
    },
    grant.state === 'absent'
  )
  await run.converge(
    sql.replace(/;$/, ''),
    grant.collection
      ? `SELECT c.relacl::text AS acl, ARRAY(SELECT a.attacl::text FROM pg_attribute a
             WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns
             FROM pg_class c WHERE c.oid=to_regclass($1)`
      : 'SELECT nspacl::text AS acl FROM pg_namespace WHERE nspname=$1',
    [grant.collection ? ident(workspace.slug, grant.collection) : workspace.slug],
    [sql]
  )
}

/** A row policy: dropped and made again, so that every saying of it is the manifest's. */
async function applyPolicy(run: Run, workspace: Workspace, policy: Workspace['policies'][number]) {
  const statements = [dropPolicyStatement(workspace.slug, policy.collection, policy.name)]
  if (policy.state === 'present')
    statements.push(
      policyStatement({
        schema: workspace.slug,
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
    `${policy.state === 'present' ? 'set' : 'drop'} policy ${policy.name} on ${workspace.slug}.${policy.collection}`,
    `SELECT permissive,roles::text,cmd,qual,with_check FROM pg_policies
        WHERE schemaname=$1 AND tablename=$2 AND policyname=$3`,
    [workspace.slug, policy.collection, policy.name],
    statements
  )
}

export async function applyWorkspace(run: Run, w: Workspace) {
  const owner = (
    await run.one<{ owner: string }>(
      'SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname=$1',
      [w.slug]
    )
  )?.owner
  if (owner && w.owner && owner !== w.owner)
    throw new Error(`Workspace ${w.slug} is owned by ${owner}, not ${w.owner}`)
  if (w.owner) await run.member(w.owner, 'platform_users')
  if (owner) run.unchanged++
  else {
    await run.db.query(schemaStatement(w.slug, w.owner))
    run.changed(`create workspace ${w.slug}${w.owner ? ` owned by ${w.owner}` : ''}`)
  }
  // Everything inside a workspace is made as its owner, so the owner owns it.
  if (w.owner) await run.db.query(`SET LOCAL ROLE ${ident(w.owner)}`)
  await run.describe(workspaceTarget(w.slug), w.metadata)
  await applyCollections(run, w.slug, w.collections, w.relations)
  for (const grant of w.grants) await applyGrant(run, w, grant)
  for (const policy of w.policies) await applyPolicy(run, w, policy)
  if (w.owner) await run.db.query('RESET ROLE')
}
